const RuleEngine = require('node-rules');
const _ = require('lodash');
const config = require('config');
const logger = require('cli-logger');
const redis = require('redis');
const getBalances = require('./lib/get-balances');
const Account = require('./lib/account');
const getTicker = require('./lib/get-ticker');
const buyLimit = require('./lib/buy-limit');
const sellLimit = require('./lib/sell-limit');
const tradeStub = require('./lib/trade-stub');
const helper = require('./helper');

const log = logger({ level: logger.INFO });

const redisClient = redis.createClient();
const redisClientMessageQueue = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

let marketTrend;
let lastTradeTime = 0;
let lastBuyPrice = 0;
const sienaAccount = new Account();

// Automation rules
const rules = [{
  condition: function condition(R) {
    R.when(_.has(this, 'netAssetValue') && (this.netAssetValue < config.get('sienaAccount.criticalPoint')));
  },
  consequence: function consequence(R) {
    this.actions = ['sellSecurity', 'halt'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'bittrexAccountBalances'));
  },
  consequence: function consequence(R) {
    this.actions = ['compartmentaliseAccount'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'movingAverageShort') &&
      _.has(this, 'movingAverageMid') &&
      this.movingAverageShort > this.movingAverageMid);
  },
  consequence: function consequence(R) {
    this.fact = { trend: 'UP' };
    this.actions = ['infer', 'compareMarketTrends'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'movingAverageShort') &&
      _.has(this, 'movingAverageMid') &&
      this.movingAverageShort <= this.movingAverageMid);
  },
  consequence: function consequence(R) {
    this.fact = { trend: 'DOWN' };
    this.actions = ['infer', 'compareMarketTrends'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'movingAverageShort') &&
      _.has(this, 'movingAverageLong') &&
      this.movingAverageShort <= this.movingAverageLong);
  },
  consequence: function consequence(R) {
    this.fact = { trend: 'BEAR' };
    this.actions = ['infer', 'compareMarketTrends'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'crossover') &&
      _.has(this, 'currentTime') &&
      _.has(this, 'lastTradeTime') &&
      this.crossover === 'UP' &&
      (this.currentTime - this.lastTradeTime) >= config.get('strategy.shortPeriod'));
  },
  consequence: function consequence(R) {
    this.actions = ['buySecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'crossover') &&
      _.has(this, 'currentAskPrice') &&
      _.has(this, 'lastBuyPrice') &&
      this.crossover === 'DOWN' &&
      this.currentAskPrice > this.lastBuyPrice);
  },
  consequence: function consequence(R) {
    this.actions = ['sellSecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'crossover') &&
      this.crossover === 'BEAR');
  },
  consequence: function consequence(R) {
    this.actions = ['sellSecurity'];
    R.stop();
  },
}];

const compareMarketTrends = async (trend) => {
  // Update the market trend, UP or DOWN
  if (marketTrend !== undefined && marketTrend !== trend) {
    const fact = { crossover: trend,
      currentTime: new Date().getTime(),
      lastTradeTime,
    };

    if (lastBuyPrice > 0) {
      fact.lastBuyPrice = lastBuyPrice;
      const ticker = await getTicker(config.get('bittrexMarket'));
      fact.currentAskPrice = ticker.Ask;
    }

    redisClientMessageQueue.publish('facts', JSON.stringify(fact));
  }

  log.info(`updateMarketTrend : ${trend}, ${(marketTrend || 'nevermind')}`);
  marketTrend = trend;
};

const compartmentaliseAccount = (bittrexAccountBalances) => {
  sienaAccount.setBittrexBalance(bittrexAccountBalances);
  redisClientMessageQueue.publish('facts', JSON.stringify({ accountBalance: sienaAccount.getBalanceNumber() }));
};

const updateBalance = async () => {
  const balances = await getBalances();
  redisClientMessageQueue.publish('facts', JSON.stringify({ bittrexAccountBalances: balances }));
  return balances;
};

const updateLastTradeTime = async (expectedBalance, price = undefined) => {
  const account = new Account();
  const balance = account.setBittrexBalance(await updateBalance());
  log.info(`updateLastTradeTime: actual balance:${balance}, expected balance: ${expectedBalance}.`);
  if (balance.toFixed(3) === expectedBalance.toFixed(3)) {
    lastBuyPrice = price;

    // Buy was successful
    lastTradeTime = new Date().getTime();
    log.info(`lastTradeTime: ${lastTradeTime}, lastBuyPrice: ${(lastBuyPrice || 'nevermind')}`);
  }
};

const buySecurity = async () => {
  const tasks = [
    getBalances(),
    getTicker(config.get('bittrexMarket')),
  ];
  const timeSinceLastTrade = new Date().getTime() - lastTradeTime;
  if (timeSinceLastTrade < config.get('strategy.shortPeriod')) {
    log.info(`buySecurity, timeSinceLastTrade: ${helper.millisecondsToHours(timeSinceLastTrade)}. Passing buy signal.`);
  }

  const [bittrexBalances, ticker] = await Promise.all(tasks);
  sienaAccount.setBittrexBalance(bittrexBalances);

  const buyQuantity = sienaAccount.getTradeAmount() / ticker.Ask;
  const commission = tradeStub.getCommission(buyQuantity, ticker.Ask);
  const buyLesserQuantity = (sienaAccount.getTradeAmount() - commission) / ticker.Ask;

  log.info(`buySecurity: Buy ${buyLesserQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Ask}`);
  const order = await buyLimit(config.get('bittrexMarket'), buyLesserQuantity, ticker.Ask);
  log.info(`buySecurity, buyOrderUuid: ${order.uuid}`);
  const trade = tradeStub.buy(buyLesserQuantity, ticker.Ask);
  const expectedBalance = sienaAccount.getBalanceNumber() - trade.total;

  // Assume that this order gets filled and then update the balance
  setTimeout(() => { updateLastTradeTime(expectedBalance, ticker.Ask); }, 10000);
};

const sellSecurity = async () => {
  const tasks = [
    getBalances(),
    getTicker(config.get('bittrexMarket')),
  ];

  const [bittrexBalances, ticker] = await Promise.all(tasks);
  sienaAccount.setBittrexBalance(bittrexBalances);

  const securityQuantity = sienaAccount.getBittrexBalance();
  if (securityQuantity > 0) {
    log.info(`sellSecurity: Sell ${securityQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Bid}`);
    const order = await sellLimit(config.get('bittrexMarket'), securityQuantity, ticker.Bid);
    log.info(`sellSecurity, sellOrderUuid: ${order.uuid}`);
    const trade = tradeStub.sell(securityQuantity, ticker.Bid);
    const expectedBalance = sienaAccount.getBalanceNumber() + trade.total;

    // Assume that this order gets filled and then update the balance
    setTimeout(() => { updateLastTradeTime(expectedBalance); }, 10000);
  } else {
    log.info('sellSecurity: No security to Sell');
  }
};

// initialize the rule engine
const R = new RuleEngine(rules);

redisClient.on('message', (channel, message) => {
  try {
    const fact = JSON.parse(message);

    // Pass the fact on to the rule engine for results
    R.execute(fact, (result) => {
      log.info(`Siena Rules : fact : ${JSON.stringify(fact)}`);

      if (_.includes(result.actions, 'infer') && _.has(result, 'fact')) {
        redisClientMessageQueue.publish('facts', JSON.stringify(result.fact));
      }

      if (_.includes(result.actions, 'compareMarketTrends') && _.has(result, 'fact.trend')) {
        compareMarketTrends(result.fact.trend);
      }

      if (_.includes(result.actions, 'compartmentaliseAccount') && _.has(result, 'bittrexAccountBalances')) {
        compartmentaliseAccount(result.bittrexAccountBalances);
      }

      if (_.includes(result.actions, 'buySecurity')) {
        buySecurity();
      }

      if (_.includes(result.actions, 'sellSecurity')) {
        sellSecurity();
      }
    });
  } catch (error) {
    log.error('Siena Rules : Error : ', error);
  }
});

redisClient.subscribe('facts');
updateBalance();
