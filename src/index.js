const RuleEngine = require('node-rules');
const _ = require('lodash');
const config = require('config');
const logger = require('cli-logger');
const redis = require('redis');
const getBalances = require('./lib/get-balances');
const Account = require('./lib/account');
const getTicker = require('./lib/get-ticker');
const getRange = require('./lib/get-range');
const buyLimit = require('./lib/buy-limit');
const sellLimit = require('./lib/sell-limit');
const tradeStub = require('./lib/trade-stub');
const helper = require('./helper');
const poll = require('./poll');

const log = logger({ level: logger.INFO });

const redisClient = redis.createClient();
const redisClientForCacheOperations = redis.createClient();
const redisClientMessageQueue = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

let crossover;
let lastTrade;
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
      _.has(this, 'movingAverageLong'));
  },
  consequence: function consequence(R) {
    this.actions = ['getMarketTrend'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'event') &&
      _.has(this, 'trend') &&
      _.has(this, 'market') &&
      _.has(this, 'lastTrade') &&
      this.event === 'crossover' &&
      this.trend === 'DOWN' &&
      this.lastTrade !== 'BUY' &&
      this.market === 'BULL-OR-FLAT');
  },
  consequence: function consequence(R) {
    // Buy security on the cheap as long as it isn't a bear market.
    this.actions = ['buySecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'event') &&
      _.has(this, 'lastTrade') &&
      _.has(this, 'market') &&
      _.has(this, 'lastBuyPrice') &&
      _.has(this, 'currentBidPrice') &&
      _.has(this, 'rangePercentage') &&
      this.event === 'crossover' &&
      this.currentBidPrice > (this.lastBuyPrice + (this.rangePercentage * this.lastBuyPrice)) &&
      this.lastTrade !== 'SELL' &&
      this.market === 'BULL-OR-FLAT');
  },
  consequence: function consequence(R) {
    // You've got a profit so cash in!
    this.actions = ['sellSecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'event') &&
      _.has(this, 'lastTrade') &&
      _.has(this, 'market') &&
      this.event === 'crossover' &&
      this.lastTrade === 'BUY' &&
      this.market === 'BEAR');
  },
  consequence: function consequence(R) {
    // This is a bear market, sell and wait for better buying opportunity.
    this.actions = ['sellSecurity'];
    R.stop();
  },
}];

const getMarketTrend = async (movingAverageShort, movingAverageMid, movingAverageLong) => {
  const currentMarket = {};
  if (movingAverageShort > movingAverageMid) {
    currentMarket.trend = 'UP';
  } else {
    currentMarket.trend = 'DOWN';
  }

  if (movingAverageShort <= movingAverageLong) {
    currentMarket.market = 'BEAR';
  } else {
    currentMarket.market = 'BULL-OR-FLAT';
  }
  log.info(`getMarketTrend, trend : ${currentMarket.trend}, market: ${(currentMarket.market || 'nevermind')}`);

  if (crossover === undefined) {
    crossover = currentMarket;
  }

  if (_.isEqual(crossover, currentMarket)) {
    // The market has not crossedOver based on the last value
    return false;
  }

  // Market has crossedOver
  crossover = currentMarket;
  const fact = _.cloneDeep(crossover);
  fact.event = 'crossover';
  fact.crossoverTime = new Date().getTime();
  fact.lastTradeTime = lastTradeTime;
  fact.lastTrade = lastTrade;

  const tasks = [
    getRange(config.get('bittrexMarket')),
    getTicker(config.get('bittrexMarket')),
  ];

  const [range, ticker] = await Promise.all(tasks);

  if (lastBuyPrice > 0) {
    fact.lastBuyPrice = lastBuyPrice;
    fact.rangePercentage = range / ticker.Bid;
    fact.currentBidPrice = ticker.Bid;
  }
  log.info(`getMarketTrend, crossoverTime: ${fact.crossoverTime}`);

  redisClientMessageQueue.publish('facts', JSON.stringify(fact));

  // Cache crossover for strategy analysis
  // Cache recommendation
  const crossoverCacheData = {
    movingAverageShort,
    movingAverageMid,
    movingAverageLong,
    trend: currentMarket.trend,
    market: currentMarket.market,
    bidPrice: ticker.Bid,
    askPrice: ticker.Ask,
    timestamp: new Date(),
  };

  redisClientForCacheOperations.zadd([`${config.get('bittrexMarket')}-crossovers`, new Date().getTime(), `${JSON.stringify(crossoverCacheData)}`]);
  return currentMarket;
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

const updateLastTradeTime = async (expectedBalance, action, price = undefined) => {
  const account = new Account();
  const balance = account.setBittrexBalance(await updateBalance());
  log.info(`updateLastTradeTime: actual balance:${balance}, expected balance: ${expectedBalance}.`);
  if (balance.toFixed(3) === expectedBalance.toFixed(3)) {
    lastBuyPrice = price;

    // trade was successful
    lastTradeTime = new Date().getTime();
    lastTrade = action;
    log.info(`updateLastTradeTime: lastTradeTime: ${lastTradeTime}, lastBuyPrice: ${(lastBuyPrice || 'nevermind')}`);
  } else {
    log.warn('updateLastTradeTime: lastTrade unsuccessful');
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
  if (sienaAccount.getBalanceNumber() < 1) {
    log.warn(`buySecurity, account Balance : ${sienaAccount.getBalanceNumber()}. Not enough balance`);
    return (false);
  }

  const buyQuantity = sienaAccount.getTradeAmount() / ticker.Ask;
  const commission = tradeStub.getCommission(buyQuantity, ticker.Ask);
  const buyLesserQuantity = (sienaAccount.getTradeAmount() - commission) / ticker.Ask;

  log.info(`buySecurity: Buy ${buyLesserQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Ask}`);
  const order = await buyLimit(config.get('bittrexMarket'), buyLesserQuantity, ticker.Ask);
  log.info(`buySecurity, buyOrderUuid: ${order.uuid}`);
  const trade = tradeStub.buy(buyLesserQuantity, ticker.Ask);
  const expectedBalance = sienaAccount.getBalanceNumber() - trade.total;

  // Assume that this order gets filled and then update the balance
  setTimeout(() => { updateLastTradeTime(expectedBalance, 'BUY', ticker.Ask); }, 30000);
  return (true);
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
    setTimeout(() => { updateLastTradeTime(expectedBalance, 'SELL'); }, 30000);
    return (true);
  }

  log.warn('sellSecurity: No security to Sell');
  return (false);
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

      if (_.includes(result.actions, 'getMarketTrend')
          && _.has(result, 'movingAverageShort')
          && _.has(result, 'movingAverageMid')
          && _.has(result, 'movingAverageLong')) {
        getMarketTrend(result.movingAverageShort,
          result.movingAverageMid, result.movingAverageLong);
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

// Keep polling the moving averages
setInterval(() => poll(config.get('bittrexMarket')), 5000);

// Listen for facts
redisClient.subscribe('facts');

// Update the current balance
updateBalance().then((bittrexBalances) => {
  const account = new Account();
  if (account.setBittrexBalance(bittrexBalances) > 1) {
    // Some crypto currency should have been sold to have this balance
    lastTrade = 'SELL';
  } else {
    lastTrade = 'BUY';
  }
});
