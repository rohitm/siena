const request = require('request');
const bunyan = require('bunyan');
const config = require('config');
const getTicker = require('./lib/get-ticker');
const helper = require('./helper');
const fs = require('fs');
const tradeStub = require('./lib/trade-stub');
const Account = require('./lib/account');

const log = bunyan.createLogger({ name: 'evaluate-strategy' });

const getCrossovers = market => new Promise(async (resolveGetCrossovers, rejectGetCrossovers) => request(`${config.get('bittrexCache.getcrossoverurl')}?market=${market}`, (error, response) => {
  if (error) {
    return rejectGetCrossovers(error);
  }

  if (response.body === undefined) {
    return rejectGetCrossovers(new Error('Empty body'));
  }

  let jsonBody;
  try {
    jsonBody = JSON.parse(response.body);
  } catch (jsonParseError) {
    return rejectGetCrossovers(jsonParseError);
  }

  return resolveGetCrossovers(jsonBody.result);
}));

(async () => {
  const tasks = [
    getTicker(config.get('bittrexMarket')),
    getCrossovers(config.get('bittrexMarket')),
  ];

  const [ticker, crossoverData] = await Promise.all(tasks);
  if (crossoverData.length === 0) {
    log.error(`No crossover data from ${config.get('bittrexCache.getcrossoverurl')}`);
    process.exit();
  }

  let tradeAmount = 1000; // How much currency you have to trade
  const account = new Account(config.get('sienaAccount.baseCurrency'), tradeAmount);
  const buySellPoints = [];
  const bidPrices = [];
  const strategyResult = crossoverData.reduce((accumatedPosition, crossoverPoint) => {
    const position = accumatedPosition;
    const timeSinceLastTrade = helper.cleanBittrexTimestamp(crossoverPoint.timestamp) -
      position.lastTradeTime;

    // Only buy if the trend is up, AND
    // you have some amount to trade, AND
    // it has been atleast sometime since your last trade

    log.info(`trend:${crossoverPoint.trend}, crossoverTime: ${crossoverPoint.timestamp}, market:${(crossoverPoint.market || 'nevermind')}, balance:${position.account.getBalanceNumber()}, timeSinceLastTrade: ${helper.millisecondsToHours(timeSinceLastTrade)}, lastBuyPrice: ${(position.lastBuyPrice || 'nevermind')}, bidPrice: ${crossoverPoint.bidPrice}, securityBalance: ${position.security}`);
    if (!isNaN(crossoverPoint.bidPrice) &&
      crossoverPoint.bidPrice > 0 &&
      crossoverPoint.bidPrice !== null) {
      bidPrices.push(`${helper.cleanBittrexTimestamp(crossoverPoint.timestamp)},${crossoverPoint.bidPrice}`);
    }
    if (
      position.account.getBalanceNumber() > 1 &&
      ((
        crossoverPoint.market === 'BEAR' || crossoverPoint.market === 'BULL'
      ))
    ) {
      log.info(`position.lastTrade: ${position.lastTrade}`);
      log.info(`Time since last trade : ${helper.millisecondsToHours(timeSinceLastTrade)}`);
      // Buy at ask price
      // Commission is in USDT
      const quantity = position.account.getTradeAmount() / crossoverPoint.askPrice;
      const commission = tradeStub.getCommission(quantity, crossoverPoint.askPrice);
      const buyLesserQuantity = (position.account.getTradeAmount() - commission)
        / crossoverPoint.askPrice;
      const trade = tradeStub.buy(buyLesserQuantity, crossoverPoint.askPrice);

      position.security = trade.security;
      position.account.debit(trade.total);
      position.lastTradeTime = helper.cleanBittrexTimestamp(crossoverPoint.timestamp);
      position.lastBuyPrice = crossoverPoint.askPrice;
      position.lastTrade = 'BUY';
      log.info(`Traded on ${new Date(position.lastTradeTime)}`);
      buySellPoints.push(`${helper.cleanBittrexTimestamp(crossoverPoint.timestamp)},${crossoverPoint.askPrice},1`);
    } else if (
      (
        (
          // Dont sell in a bull market
          crossoverPoint.market !== 'BULL' &&
          // Make sure the sell price is some percentage higher than the buy price
          crossoverPoint.bidPrice > (position.lastBuyPrice + (0.01 * position.lastBuyPrice))
        ) ||
        (
          // Market has turned bear, cut your loss short
          crossoverPoint.market === 'BEAR' &&
          crossoverPoint.bidPrice < (position.lastBuyPrice - (0.1 * position.lastBuyPrice))
        )
      ) && position.security > 0
        && position.lastTrade === 'BUY') {
      // Sell at the bid price
      // Commission is in USDT
      const quantity = position.security;
      const trade = tradeStub.sell(quantity, crossoverPoint.bidPrice);
      position.account.credit(trade.total);
      position.security = 0;
      position.lastTradeTime = helper.cleanBittrexTimestamp(crossoverPoint.timestamp);
      if (crossoverPoint.market === 'BEAR') {
        position.lastTrade = 'SELL-LOW';
      } else {
        position.lastTrade = 'SELL-HIGH';
      }
      position.lastSellPrice = crossoverPoint.bidPrice;
      log.info(`Traded on ${new Date(position.lastTradeTime)}`);
      buySellPoints.push(`${helper.cleanBittrexTimestamp(crossoverPoint.timestamp)},${crossoverPoint.bidPrice},0`);
    }

    return (position);
  }, { security: 0, account, lastTradeTime: null });
  if (strategyResult.security > 0) {
    // Sell off any security
    const trade = tradeStub.sell(strategyResult.security, ticker.Ask);
    strategyResult.account.credit(trade.total);
  }
  log.info('Simulating strategy less buy and sale');
  // Buy it during the first value of the crossover
  const nonStrategyBuyTrade = tradeStub.buy(
    tradeAmount / crossoverData[0].askPrice,
    crossoverData[0].askPrice);
  const security = nonStrategyBuyTrade.security;

  // Sell it for the current asking price
  const nonStrategySellTrade = tradeStub.sell(security, ticker.Ask);
  tradeAmount = nonStrategySellTrade.total;

  // Generate a file with all the buy and sell points.
  const strategyResultDataFile = 'tradeHistory.txt';
  const strategyResultData = buySellPoints.join('\n');

  // Generate a file with all the crossover points
  const crossoverDataFile = 'crossoverData.txt';
  const crossoverPricesData = bidPrices.join('\n');

  log.info(`Current balance based on strategy : ${strategyResult.account.getBalanceNumber()}, Current balance if you just bought and sold : ${tradeAmount}`);

  const fileWriteTasks = [
    new Promise(async resolveWrite => fs.writeFile(
      strategyResultDataFile,
      strategyResultData,
      resolveWrite)),
    new Promise(async resolveWrite => fs.writeFile(
      crossoverDataFile,
      crossoverPricesData,
      resolveWrite)),
  ];

  await Promise.all(fileWriteTasks);

  log.info('Done!');
})();
