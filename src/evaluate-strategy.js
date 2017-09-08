const request = require('request');
const logger = require('cli-logger');
const config = require('config');
const getTicker = require('./lib/get-ticker');
const getMarketHistory = require('./lib/get-market-history');
const helper = require('./helper');
const _ = require('lodash');
const fs = require('fs');
const tradeStub = require('./lib/trade-stub');
const Account = require('./lib/account');

const log = logger({ level: logger.INFO });

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

  let tradeAmount = 1000; // How much currency you have to trade
  const account = new Account(config.get('sienaAccount.baseCurrency'), tradeAmount);
  const buySellPoints = [];

  const strategyResult = crossoverData.reduce((accumatedPosition, crossoverPoint) => {
    const position = accumatedPosition;
    const timeSinceLastTrade = helper.cleanBittrexTimestamp(crossoverPoint.timestamp) -
      position.lastTradeTime;

    // Only buy if the trend is up, AND
    // you have some amount to trade, AND
    // it has been atleast an hour since your last trade
    if (crossoverPoint.trend === 'UP'
      && position.account.getBalanceNumber() > 0
      && timeSinceLastTrade >= config.get('strategy.shortPeriod')) {
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
      buySellPoints.push(`${helper.cleanBittrexTimestamp(crossoverPoint.timestamp)},${crossoverPoint.askPrice},1`);
    } else if (
      crossoverPoint.trend === 'DOWN'
      && position.security > 0) {
      log.info(`Time since last trade : ${helper.millisecondsToHours(timeSinceLastTrade)}`);
      // Sell at the bid price
      // Commission is in USDT
      const quantity = position.security;
      const trade = tradeStub.sell(quantity, crossoverPoint.bidPrice);
      position.account.credit(trade.total);
      position.security = 0;
      position.lastTradeTime = helper.cleanBittrexTimestamp(crossoverPoint.timestamp);
      buySellPoints.push(`${helper.cleanBittrexTimestamp(crossoverPoint.timestamp)},${crossoverPoint.bidPrice},0`);
    }

    log.info('-----');
    return (position);
  }, { security: 0, account, lastTradeTime: null });
  if (strategyResult.security > 0) {
    // Sell off any security
    const trade = tradeStub.sell(strategyResult.security, ticker.Ask);
    strategyResult.account.credit(trade.total);
  }

  // Buy it during the first value of the crossover
  const nonStrategyBuyTrade = tradeStub.buy(
    tradeAmount / crossoverData[0].askPrice,
    crossoverData[0].askPrice);
  const security = nonStrategyBuyTrade.security;

  // Sell it for the current asking price
  const nonStrategySellTrade = tradeStub.sell(security, ticker.Ask);
  tradeAmount = nonStrategySellTrade.total;

  // Generate a file with all the buy and sell points.
  const strategyResultDataFile = 'strategyResultData.txt';
  const strategyResultData = buySellPoints.join('\n');

  log.info(`Current balance based on strategy : ${strategyResult.account.getBalanceNumber()}, Current balance if you just bought and sold : ${tradeAmount}`);

  const tradeHistoryDataFile = 'tradeHistory.txt';

  // Get the market history to plot the data
  const toTimestamp = new Date().getTime();
  const fromTimestamp24 = toTimestamp - (3600000 * 168); // 24 hours

  const marketHistoryData = await getMarketHistory(config.get('bittrexMarket'), fromTimestamp24, toTimestamp, 'bittrexCache');
  const filteredData = helper.getSoldPricesBetweenPeriod(marketHistoryData,
    fromTimestamp24,
    toTimestamp);

  const timestamps = _.map(filteredData, object =>
    helper.cleanBittrexTimestamp(object.TimeStamp));
  log.info(`Timestamps between ${new Date(Math.min(...timestamps))} and ${new Date(Math.max(...timestamps))} for about ${(Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60)} hours`);

  const tradeHistoryData = _.map(filteredData, object => `${helper.cleanBittrexTimestamp(object.TimeStamp)},${object.Price}`).join('\n');

  const fileWriteTasks = [
    new Promise(async resolveWrite => fs.writeFile(
      tradeHistoryDataFile,
      tradeHistoryData,
      resolveWrite)),
    new Promise(async resolveWrite => fs.writeFile(
      strategyResultDataFile,
      strategyResultData,
      resolveWrite)),
  ];

  await Promise.all(fileWriteTasks);

  log.info('Done!');
})();
