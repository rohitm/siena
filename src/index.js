const RuleEngine = require('node-rules');
const _ = require('lodash');
const config = require('config');
const redis = require('redis');
const getBalances = require('./lib/get-balances');
const Account = require('./lib/account');
const getTicker = require('./lib/get-ticker');
const getRange = require('./lib/get-range');
const getUpperSellPercentage = require('./lib/get-upper-sell-percentage');
const buyLimit = require('./lib/buy-limit');
const sellLimit = require('./lib/sell-limit');
const tradeStub = require('./lib/trade-stub');
const helper = require('./helper');
const poll = require('./poll');
const bunyan = require('bunyan');

const log = bunyan.createLogger({ name: 'siena' });

const redisClient = redis.createClient(config.get('redis.port'), config.get('redis.hostname'), { no_ready_check: true });
const redisClientForCacheOperations = redis.createClient(config.get('redis.port'), config.get('redis.hostname'), { no_ready_check: true });
const redisClientMessageQueue = redis.createClient(config.get('redis.port'), config.get('redis.hostname'), { no_ready_check: true });
redisClient.on('error', redisError => log.error(redisError));

let crossover;
let lastTrade;
let principle = 0;
let lastTradeTime = 0;
let lastBuyPrice = 0;
let lastSellPrice = 0;
let upperSellPercentage = config.get('strategy.upperSellPercentage');
let transactionLock = false;
let allowTrading = config.get('trade');
const sienaAccount = new Account();

// Automation rules
const rules = [{
  condition: function condition(R) {
    R.when(_.has(this, 'principle') &&
     _.has(this, 'currentAccountValue') &&
     this.currentAccountValue < (this.principle - (config.get('sienaAccount.criticalPoint') * this.principle)));
  },
  consequence: function consequence(R) {
    // Market has crashed and your capital has eroded, Bail out!
    this.actions = ['halt'];
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
    this.actions = ['getMarketTrend', 'getAccountValue'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'event') &&
      _.has(this, 'market') &&
      _.has(this, 'lastTrade') &&
      this.event === 'crossover' &&
      this.market === 'BULL' &&
      this.lastTrade !== 'BUY');
  },
  consequence: function consequence(R) {
    // Buy security at the start of a bull run
    this.actions = ['buySecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'event') &&
      _.has(this, 'market') &&
      _.has(this, 'lastTrade') &&
      _.has(this, 'currentBidPrice') &&
      _.has(this, 'lastSellPrice') &&
      this.event === 'crossover' &&
      this.market !== 'BEAR' &&
      this.lastTrade === 'SELL-LOW' &&
      this.currentBidPrice < this.lastSellPrice);
  },
  consequence: function consequence(R) {
    // We've incurred a loss from the last sale so buy it on the cheaper than your last sell price.
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
      this.currentBidPrice > (this.lastBuyPrice + (upperSellPercentage * this.lastBuyPrice)) &&
      this.lastTrade === 'BUY' &&
      this.market !== 'BULL');
  },
  consequence: function consequence(R) {
    // You've got a profit so cash in!
    this.actions = ['sellSecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'lastTrade') &&
      _.has(this, 'market') &&
      _.has(this, 'lastBuyPrice') &&
      _.has(this, 'currentBidPrice') &&
      this.currentBidPrice < (this.lastBuyPrice - (config.get('strategy.lowerSellPercentage') * this.lastBuyPrice)) &&
      this.lastTrade === 'BUY' &&
      this.market === 'BEAR');
  },
  consequence: function consequence(R) {
    // This is a bear market, sell and wait for better buying opportunity.
    this.actions = ['sellSecurity'];
    R.stop();
  },
}];

const getAccountValue = async () => {
  if (transactionLock) {
    // Only Compute account balances when a transaction is not in progress
    return false;
  }

  const account = new Account();
  account.setBittrexBalance(sienaAccount.getBittrexBalanceObj());
  const currentAccountValue = await account.getAccountValue();
  redisClientMessageQueue.publish('facts', JSON.stringify({ principle, currentAccountValue }));
  return currentAccountValue;
};

const getMarketTrend = async (movingAverageShort, movingAverageMid, movingAverageLong) => {
  const currentMarket = {};
  if (movingAverageShort > movingAverageMid) {
    currentMarket.trend = 'UP';
  } else {
    currentMarket.trend = 'DOWN';
  }

  if (movingAverageShort >= movingAverageMid && movingAverageMid >= movingAverageLong) {
    currentMarket.market = 'BULL';
  } else if (movingAverageLong >= movingAverageMid && movingAverageMid >= movingAverageShort) {
    currentMarket.market = 'BEAR';
  } else if (movingAverageMid >= movingAverageShort && movingAverageShort >= movingAverageLong) {
    currentMarket.market = 'VOLATILE-MID';
  } else if (movingAverageLong >= movingAverageShort && movingAverageShort >= movingAverageMid) {
    currentMarket.market = 'VOLATILE-RECOVERY';
  } else if (movingAverageMid >= movingAverageLong && movingAverageLong >= movingAverageShort) {
    currentMarket.market = 'VOLATILE-LOW';
  } else if (movingAverageShort >= movingAverageLong && movingAverageLong >= movingAverageMid) {
    currentMarket.market = 'VOLATILE';
  } else {
    currentMarket.market = 'FLAT';
  }

  log.info(`getMarketTrend, trend : ${currentMarket.trend}, market: ${(currentMarket.market || 'nevermind')}`);

  if (crossover === undefined) {
    crossover = currentMarket;
  }

  let bearTicker;
  if (currentMarket.market === 'BEAR' && lastTrade === 'BUY' && lastBuyPrice > 0) {
    const bearFact = _.cloneDeep(currentMarket);
    bearFact.lastTrade = lastTrade;
    bearFact.lastBuyPrice = lastBuyPrice;

    bearTicker = await getTicker(config.get('bittrexMarket'));
    bearFact.currentBidPrice = bearTicker.Bid;

    // We need to publish this fact to the rules engine so that we can SELL
    // at the right time instead of waiting for a crossover moment.
    redisClientMessageQueue.publish('facts', JSON.stringify(bearFact));
  }

  if (_.isEqual(crossover, currentMarket)) {
    // The market has not crossedOver based on the last value
    return false;
  }

  // Market has crossedOver
  crossover = currentMarket;
  const fact = _.cloneDeep(crossover);
  fact.movingAverageSpread = Math.max(movingAverageLong, movingAverageMid, movingAverageShort)
    - Math.min(movingAverageLong, movingAverageMid, movingAverageShort);
  fact.event = 'crossover';
  fact.crossoverTime = new Date().getTime();
  fact.lastTradeTime = lastTradeTime;
  fact.lastTrade = lastTrade;

  const tasks = [
    getRange(config.get('bittrexMarket')),
    bearTicker || getTicker(config.get('bittrexMarket')),
  ];

  const [range, ticker] = await Promise.all(tasks);
  fact.currentBidPrice = ticker.Bid;
  fact.rangePercentage = range / ticker.Bid;

  if (lastBuyPrice > 0) {
    fact.lastBuyPrice = lastBuyPrice;
  }

  if (lastSellPrice > 0) {
    fact.lastSellPrice = lastSellPrice;
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
  if (balance.toFixed(2) === expectedBalance.toFixed(2)) {
    if (action === 'BUY') {
      lastBuyPrice = price;

      // Calculate the SELL trigger prices
      upperSellPercentage = await getUpperSellPercentage(price);
      const upperBand = upperSellPercentage * parseFloat(lastBuyPrice);
      const lowerBand = config.get('strategy.lowerSellPercentage') * parseFloat(lastBuyPrice);
      const lowerSellTriggerPrice = parseFloat(lastBuyPrice) - lowerBand;
      const upperSellTriggerPrice = parseFloat(lastBuyPrice) + upperBand;
      log.info(`getMarketTrend, Upper SELL trigger price:${upperSellTriggerPrice}`);
      log.info(`getMarketTrend, Lower SELL trigger price:${lowerSellTriggerPrice}`);
    } else {
      lastSellPrice = price;
    }

    // trade was successful
    lastTradeTime = new Date().getTime();
    lastTrade = action;
    transactionLock = false;
    log.info(`updateLastTradeTime: lastTradeTime: ${lastTradeTime}, lastBuyPrice: ${(lastBuyPrice || 'nevermind')}`);
  } else {
    log.error('updateLastTradeTime, Error: lastTrade unsuccessful');

    // Why didn't bittrex fill the last order even after `balancePollInterval` seconds ?
    // Terminate Siena for now, investiage if your order was filled on bittrex and restart Siena

    // TODO : Maybe notify yourself that Siena has terminated due to an unfilled order
    process.exit();
  }
};

const buySecurity = async () => {
  if (allowTrading === false) {
    log.info('buySecurity, trade: false. Skipping security trades');
    return (false);
  }

  if (transactionLock) {
    log.info('buySecurity, transactionLock: true. Transaction in progress.');
    return (false);
  }

  transactionLock = true;
  const tasks = [
    getBalances(),
    getTicker(config.get('bittrexMarket')),
  ];
  const timeSinceLastTrade = new Date().getTime() - lastTradeTime;
  if (timeSinceLastTrade < config.get('balancePollInterval')) {
    log.warn(`buySecurity, timeSinceLastTrade: ${helper.millisecondsToHours(timeSinceLastTrade)}. Should maybe passing this buy signal?`);
  }

  const [bittrexBalances, ticker] = await Promise.all(tasks);
  sienaAccount.setBittrexBalance(bittrexBalances);
  if (sienaAccount.getBalanceNumber() === 0) {
    log.error(`buySecurity Error, account Balance : ${sienaAccount.getBalanceNumber()}. Not enough balance`);
    transactionLock = false;
    return (false);
  }

  const buyQuantity = sienaAccount.getTradeAmount() / ticker.Ask;
  const commission = tradeStub.getCommission(buyQuantity, ticker.Ask);
  const buyLesserQuantity = (sienaAccount.getTradeAmount() - commission) / ticker.Ask;

  log.info(`buySecurity: Buy ${buyLesserQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Ask} on ${new Date()}`);
  const order = await buyLimit(config.get('bittrexMarket'), buyLesserQuantity, ticker.Ask);
  log.info(`buySecurity, buyOrderUuid: ${order.uuid}`);
  const trade = tradeStub.buy(buyLesserQuantity, ticker.Ask);
  const expectedBalance = sienaAccount.getBalanceNumber() - trade.total;

  // Assume that this order gets filled and then update the balance
  setTimeout(() => { updateLastTradeTime(expectedBalance, 'BUY', ticker.Ask); }, config.get('balancePollInterval'));
  return (true);
};

const sellSecurity = async () => {
  if (allowTrading === false) {
    log.info('sellSecurity, trade: false. Skipping security trades');
    return (false);
  }

  if (transactionLock) {
    log.info('sellSecurity, transactionLock: true. Transaction in progress.');
  }

  transactionLock = true;

  const tasks = [
    getBalances(),
    getTicker(config.get('bittrexMarket')),
  ];

  let ticker;
  let bittrexBalances;
  try {
    [bittrexBalances, ticker] = await Promise.all(tasks);
  } catch (err) {
    log.error(`sellSecurity, Error : ${err}`);
    transactionLock = false;
    return (false);
  }

  sienaAccount.setBittrexBalance(bittrexBalances);

  const securityQuantity = sienaAccount.getBittrexBalance();
  if (securityQuantity > 0) {
    log.info(`sellSecurity: Sell ${securityQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Bid}`);
    const order = await sellLimit(config.get('bittrexMarket'), securityQuantity, ticker.Bid);
    log.info(`sellSecurity, sellOrderUuid: ${order.uuid}`);
    const trade = tradeStub.sell(securityQuantity, ticker.Bid);
    const expectedBalance = sienaAccount.getBalanceNumber() + trade.total;

    // Assume that this order gets filled and then update the balance
    setTimeout(() => {
      updateLastTradeTime(expectedBalance,
        (parseFloat(ticker.Bid) > parseFloat(lastBuyPrice) ? 'SELL-HIGH' : 'SELL-LOW'),
        ticker.Bid);
    }, config.get('balancePollInterval'));
    return (true);
  }

  log.error('sellSecurity Error: No security to Sell');
  transactionLock = false;
  return (false);
};

const halt = async () => {
  // The market has crashed and your capital has eroded. Sell what you can stop trading!
  if (lastTrade === 'BUY') {
    await sellSecurity();
  }

  log.warn('Halting trades');
  allowTrading = false;
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

      if (_.includes(result.actions, 'getAccountValue')) {
        getAccountValue();
      }

      if (_.includes(result.actions, 'halt')) {
        halt();
      }
    });
  } catch (error) {
    log.error('Siena Rules : Error : ', error);
  }
});

// Keep polling the moving averages
setInterval(() => poll(config.get('bittrexMarket')), 5000);

// Update the priciple everyday
setInterval(async () => {
  principle = await sienaAccount.getAccountValue(await getBalances());
  log.info(`principle: ${principle}`);
}, 86400000);

// Listen for facts
redisClient.subscribe('facts');

// Update the current balance
updateBalance().then(async (bittrexBalances) => {
  sienaAccount.setBittrexBalance(bittrexBalances);

  if (sienaAccount.getBalanceNumber() > 0
    && sienaAccount.getBalanceNumber() > sienaAccount.getBittrexBalance()) {
    // Some crypto currency should have been sold to have this balance
    lastTrade = 'SELL-HIGH';
  } else {
    lastTrade = 'BUY';

    // We don't know the last price that you bought the security in your account for
    if (!Number.isNaN(parseFloat(process.argv[2]))) {
      // Get the price that was passed as a command line argument
      lastBuyPrice = parseFloat(process.argv[2]);
    } else {
      lastBuyPrice = (await getTicker(config.get('bittrexMarket'))).Ask; // Consider the current Ask price as the last buy price
    }

    log.info(`updateBalance, lastBuyPrice: ${lastBuyPrice}`);
  }
  log.info(`updateBalance, lastTrade: ${lastTrade}`);

  principle = await sienaAccount.getAccountValue();
  log.info(`updateBalance, principle: ${principle}`);
  // TODO : Cancel all open orders when the script starts
});
