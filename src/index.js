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

const log = logger({ level: logger.INFO });

const redisClient = redis.createClient();
const redisClientMessageQueue = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

let marketTrend;
const sienaAccount = new Account();

// Automation rules
const rules = [{
  condition: function condition(R) {
    R.when(_.has(this, 'accountBalance') && (this.accountBalance < config.get('sienaAccount.criticalPoint')));
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
      _.has(this, 'movingAverageLong') &&
      this.movingAverageShort > this.movingAverageLong);
  },
  consequence: function consequence(R) {
    this.fact = { trend: 'UP' };
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
    this.fact = { trend: 'DOWN' };
    this.actions = ['infer', 'compareMarketTrends'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'crossover') &&
      this.crossover === 'UP');
  },
  consequence: function consequence(R) {
    this.actions = ['buySecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'crossover') &&
      this.crossover === 'DOWN');
  },
  consequence: function consequence(R) {
    this.actions = ['sellSecurity'];
    R.stop();
  },
}];

const compareMarketTrends = (trend) => {
  // Update the market trend, UP or DOWN
  if (marketTrend !== undefined && marketTrend !== trend) {
    redisClientMessageQueue.publish('facts', { crossover: trend });
  }

  log.info(`updateMarketTrend : ${trend}, ${(marketTrend || 'nevermind')}`);
  marketTrend = trend;
};

const compartmentaliseAccount = (bittrexAccountBalances) => {
  sienaAccount.setBittrexBalance(bittrexAccountBalances);
  redisClientMessageQueue.publish('facts', JSON.stringify({ accountBalance: sienaAccount.getBalanceNumber() }));
};

const updateBalance = () => getBalances().then(
  balances => redisClientMessageQueue.publish('facts', JSON.stringify({ bittrexAccountBalances: balances })));

const buySecurity = async () => {
  const tasks = [
    getBalances(),
    getTicker(config.get('bittrexMarket')),
  ];

  const [bittrexBalances, ticker] = await Promise.all(tasks);
  sienaAccount.setBittrexBalance(bittrexBalances);

  const buyQuantity = sienaAccount.getTradeAmount() / ticker.Ask;
  const commission = tradeStub.getCommission(buyQuantity, ticker.Ask);
  const buyLesserQuantity = (sienaAccount.getTradeAmount() - commission) / ticker.Ask;

  log.info(`buySecurity: Buy ${buyLesserQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Ask}`);
  const order = await buyLimit(config.get('bittrexMarket'), buyLesserQuantity, ticker.Ask);
  log.info(`buySecurity, buyOrderUuid: ${order.uuid}`);

  // Assume that this order is filled and then update the balance
  setTimeout(updateBalance, 10000);
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

    // Assume that this order is filled and then update the balance
    setTimeout(updateBalance, 10000);
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
