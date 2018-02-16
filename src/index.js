const RuleEngine = require('node-rules');
const _ = require('lodash');
const config = require('config');
const redis = require('redis');
const getBalances = require('./lib/get-balances');
const Account = require('./lib/account');
const getTicker = require('./lib/get-ticker');
const getUpperSellPercentage = require('./lib/get-upper-sell-percentage');
const getMarketSummary = require('./lib/get-market-summary');
const buyLimit = require('./lib/buy-limit');
const sellLimit = require('./lib/sell-limit');
const tradeStub = require('./lib/trade-stub');
const helper = require('./helper');
const poll = require('./poll');
const strategyRules = require('./strategy');
const bunyan = require('bunyan');

const log = bunyan.createLogger({ name: 'siena' });

const redisClient = redis.createClient(config.get('redis.port'), config.get('redis.hostname'), { no_ready_check: true });
const redisClientForCacheOperations = redis.createClient(config.get('redis.port'), config.get('redis.hostname'), { no_ready_check: true });
const redisClientMessageQueue = redis.createClient(config.get('redis.port'), config.get('redis.hostname'), { no_ready_check: true });
redisClient.on('error', redisError => log.error(redisError));

let crossover;
let lastTrade;
let principle = 0;
let upperSellPercentage = config.get('strategy.upperSellPercentage');
let transactionLock = false;
let allowTrading = config.get('trade');
const sienaAccount = new Account();

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
    currentMarket.trend = 'up';
  } else {
    currentMarket.trend = 'down';
  }

  if (movingAverageShort >= movingAverageMid && movingAverageMid >= movingAverageLong) {
    currentMarket.market = 'bull';
  } else if (movingAverageLong >= movingAverageMid && movingAverageMid >= movingAverageShort) {
    currentMarket.market = 'bear';
  } else if (movingAverageMid >= movingAverageShort && movingAverageShort >= movingAverageLong) {
    currentMarket.market = 'volatile mid';
  } else if (movingAverageLong >= movingAverageShort && movingAverageShort >= movingAverageMid) {
    currentMarket.market = 'volatile recovery';
  } else if (movingAverageMid >= movingAverageLong && movingAverageLong >= movingAverageShort) {
    currentMarket.market = 'volatile low';
  } else if (movingAverageShort >= movingAverageLong && movingAverageLong >= movingAverageMid) {
    currentMarket.market = 'volatile';
  } else {
    currentMarket.market = 'flat';
  }

  log.info(`getMarketTrend, trend : ${currentMarket.trend}, market: ${(currentMarket.market || 'nevermind')}`);

  if (crossover === undefined) {
    crossover = currentMarket;
  }

  let bearTicker;
  if (currentMarket.market === 'bear' && lastTrade === 'buy' && sienaAccount.getLastBuyPrice() > 0) {
    const bearFact = _.cloneDeep(currentMarket);
    bearFact.lastTrade = lastTrade;
    bearFact.lastBuyPrice = sienaAccount.getLastBuyPrice();
    bearFact.lastAverageBuyPrice = sienaAccount.getLastAverageBuyPrice();
    bearFact.upperSellPercentage = upperSellPercentage;

    bearTicker = await getTicker(config.get('bittrexMarket'));
    bearFact.currentBidPrice = bearTicker.Bid;

    // We need to publish this fact to the rules engine so that we can sell
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
  fact.lastTradeTime = sienaAccount.getLastTrade().time;
  fact.lastTrade = lastTrade;
  fact.upperSellPercentage = upperSellPercentage;

  const tasks = [
    getMarketSummary(config.get('bittrexMarket')),
    bearTicker || getTicker(config.get('bittrexMarket')),
  ];

  const [marketSummary, ticker] = await Promise.all(tasks);
  fact.marketHigh = parseFloat(marketSummary.High);
  fact.marketLow = parseFloat(marketSummary.Low);
  fact.currentBidPrice = ticker.Bid;

  if (sienaAccount.getLastBuyPrice() > 0) {
    fact.lastBuyPrice = sienaAccount.getLastBuyPrice();
    fact.lastAverageBuyPrice = sienaAccount.getLastAverageBuyPrice();
  }

  if (sienaAccount.getLastSellPrice() > 0) {
    fact.lastSellPrice = sienaAccount.getLastSellPrice();
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

const logSellTriggerPrices = (thisUpperSellPercentage, buyPrice) => {
  const upperBand = thisUpperSellPercentage * parseFloat(buyPrice);
  const lowerBand = config.get('strategy.lowerSellPercentage') * parseFloat(buyPrice);
  const lowerSellTriggerPrice = parseFloat(buyPrice) - lowerBand;
  const upperSellTriggerPrice = parseFloat(buyPrice) + upperBand;
  log.info(`logSellTriggerPrices, Upper sell trigger price:${upperSellTriggerPrice}`);
  log.info(`logSellTriggerPrices, Lower sell trigger price:${lowerSellTriggerPrice}`);
};

const updateLastTradeTime = async (expectedBalance, action, price = undefined) => {
  const account = new Account();
  const balance = account.setBittrexBalance(await updateBalance());
  log.info(`updateLastTradeTime: actual balance:${balance}, expected balance: ${expectedBalance}.`);
  if (balance.toFixed(2) === expectedBalance.toFixed(2)) {
    if (action === 'buy') {
      sienaAccount.trade('buy', price, sienaAccount.getTradeAmount());
      // Calculate the SELL trigger prices
      if (config.get('strategy.upperSell') === 'dynamic') {
        upperSellPercentage = await getUpperSellPercentage(sienaAccount.getLastAverageBuyPrice());
      }
      logSellTriggerPrices(upperSellPercentage, sienaAccount.getLastAverageBuyPrice());
    } else {
      sienaAccount.trade('sell', price, balance - sienaAccount.getBalanceNumber());
    }

    lastTrade = action;
    transactionLock = false;
    log.info(`updateLastTradeTime: lastTradeTime: ${sienaAccount.getLastTrade().time}, lastBuyPrice: ${(sienaAccount.getLastBuyPrice() || 'nevermind')}`);
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
  const timeSinceLastTrade = new Date().getTime() - sienaAccount.getLastTrade().time;
  if (timeSinceLastTrade < config.get('balancePollInterval')) {
    log.warn(`buySecurity, timeSinceLastTrade: ${helper.millisecondsToHours(timeSinceLastTrade)}. Should maybe passing this buy signal?`);
  }

  const [bittrexBalances, ticker] = await Promise.all(tasks);
  sienaAccount.setBittrexBalance(bittrexBalances);
  log.info(`buySecurity, account Balance : ${sienaAccount.getBalanceNumber()}`);
  if (sienaAccount.getBalanceNumber() <= config.get('sienaAccount.minTradeSize')) {
    log.error(`buySecurity Error, account Balance : ${sienaAccount.getBalanceNumber()}. Not enough balance`);
    transactionLock = false;
    return (false);
  }

  const buyQuantity = sienaAccount.getTradeAmount() / ticker.Ask;
  const commission = tradeStub.getCommission(buyQuantity, ticker.Ask);
  const buyLesserQuantity = (sienaAccount.getTradeAmount() - commission) / ticker.Ask;

  log.info({
    type: 'tradeHistory',
    timestamp: new Date().getTime(),
    price: ticker.Ask,
    buyOrSell: 0,
  });
  log.info(`buySecurity, getTradeAmount: ${sienaAccount.getTradeAmount()}`);
  log.info(`buySecurity: Buy ${buyLesserQuantity.toFixed(12)}${config.get('sienaAccount.securityCurrency')} for ${ticker.Ask} on ${new Date()}`);
  let order;
  try {
    order = await buyLimit(config.get('bittrexMarket'), buyLesserQuantity, ticker.Ask);
  } catch (err) {
    // Watch out for MIN_TRADE_REQUIREMENT_NOT_MET
    log.error(`buySecurity, Error : ${err}`);
    transactionLock = false;
    return (false);
  }

  log.info(`buySecurity, buyOrderUuid: ${order.uuid}`);
  const trade = tradeStub.buy(buyLesserQuantity, ticker.Ask);
  const expectedBalance = sienaAccount.getBalanceNumber() - trade.total;

  // Assume that this order gets filled and then update the balance
  setTimeout(() => { updateLastTradeTime(expectedBalance, 'buy', ticker.Ask); }, config.get('balancePollInterval'));
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
    log.info({
      type: 'tradeHistory',
      timestamp: new Date().getTime(),
      price: ticker.Bid,
      buyOrSell: 1,
    });
    log.info(`sellSecurity: Sell ${securityQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Bid}`);
    const order = await sellLimit(config.get('bittrexMarket'), securityQuantity, ticker.Bid);
    log.info(`sellSecurity, sellOrderUuid: ${order.uuid}`);
    const trade = tradeStub.sell(securityQuantity, ticker.Bid);
    const expectedBalance = sienaAccount.getBalanceNumber() + trade.total;

    // Assume that this order gets filled and then update the balance
    setTimeout(() => {
      updateLastTradeTime(expectedBalance,
        (parseFloat(ticker.Bid) > parseFloat(sienaAccount.getLastBuyPrice()) ? 'sell high' : 'sell low'),
        ticker.Bid);
    }, config.get('balancePollInterval'));
    return (true);
  }

  log.error('sellSecurity Error: No security to Sell');
  transactionLock = false;
  return (false);
};

const halt = async (currentAccountValue) => {
  if (transactionLock) {
    return false;
  }

  log.warn(`Halt: Market has crashed beyond your critical point of ${config.get('sienaAccount.criticalPoint') * 100}% from ${principle} to ${currentAccountValue}`);
  // The market has crashed and your capital has eroded. Sell what you can stop trading!
  if (lastTrade === 'buy') {
    await sellSecurity();
  }

  log.warn('Halt: Halting any further trades');
  allowTrading = false;
  return true;
};

// initialize the rule engine
const R = new RuleEngine(strategyRules[config.get('strategy.name')]);

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

      if (_.includes(result.actions, 'halt') && _.includes(fact, 'currentAccountValue')) {
        halt(fact.currentAccountValue);
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

  if (sienaAccount.getBittrexBalance() > 0) {
    lastTrade = 'buy';
    await sienaAccount.calibrateTradeAmount();

    // We don't know the last price that you bought the security in your account for
    if (!Number.isNaN(parseFloat(process.argv[2]))) {
      // Get the price that was passed as a command line argument
      sienaAccount.trade('buy', process.argv[2]);
    } else {
      sienaAccount.trade('buy', (await getTicker(config.get('bittrexMarket'))).Ask); // Consider the current Ask price as the last buy price
    }

    log.info(`updateBalance, lastBuyPrice: ${sienaAccount.getLastBuyPrice()}`);
    logSellTriggerPrices(upperSellPercentage, sienaAccount.getLastAverageBuyPrice());
  } else if (sienaAccount.getBalanceNumber() > 0) {
    // Some crypto currency should have been sold to have this balance
    lastTrade = 'sell high';
  }

  log.info(`updateBalance, lastTrade: ${lastTrade}`);

  principle = await sienaAccount.getAccountValue();
  log.info(`updateBalance, principle: ${principle}`);
  // TODO : Cancel all open orders when the script starts
});
