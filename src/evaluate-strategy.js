const request = require('request');
const logger = require('cli-logger');
const config = require('config');
const getTicker = require('./lib/get-ticker');
const getMarketHistory = require('./lib/get-market-history');
const helper = require('./helper');
const _ = require('lodash');
const fs = require('fs');
const tradeStub = require('./lib/trade-stub');

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
  const strategyResult = crossoverData.reduce((accumatedPosition, crossoverPoint) => {
    const position = accumatedPosition;

    if (crossoverPoint.trend === 'UP' && position.tradeAmount > 0) {
      // Buy at ask price
      // Commission is in USDT
      const quantity = position.tradeAmount / crossoverPoint.askPrice;
      const hypotheticalLowerBuyPrice = helper.adjustBuyPriceToCommission(position.tradeAmount, quantity);
      const trade = tradeStub.buy(quantity, crossoverPoint.askPrice);

      position.security = trade.security;
      position.tradeAmount = 0;
    } else if (crossoverPoint.trend === 'DOWN' && position.security > 0) {
      // Sell at the bid price
      // Commission is in USDT
      // ( Wanted Higher eth price * security qty) * (1 - bittrex commission) = security qty * actual eth price
      const quantity = position.security;
      const hypotheticalHigherSalePrice = helper.adjustSellPriceToCommission(crossoverPoint.bidPrice);
      const trade = tradeStub.sell(quantity, crossoverPoint.bidPrice);
      const balance = trade.total;
      position.security = 0;
      // Compartmentalise the amount available to trade
      // Move the profits into the reserve ;
      // Keep the tradable amount only to the limit

      if (balance > tradeAmount) {
        log.info(`Gains: ${(balance - tradeAmount)}`);
        // Made a profit so move it into the reserve amount
        position.reserve += balance - tradeAmount;
        position.tradeAmount = tradeAmount;
      } else {
        log.warn(`Losses: ${(tradeAmount - balance)}`);
        // Made a loss, so borrow some cash from the reserve
        const requiredAmount = tradeAmount - balance;
        log.warn(`Reserve: ${position.reserve}`);
        if (requiredAmount > position.reserve) {
          log.info('Not enough reserve balance');
          // TODO : We have a problem, Stop trading maybe...
          position.tradeAmount = balance;
        } else {
          position.reserve -= requiredAmount;
          position.tradeAmount = tradeAmount;
        }
      }
    }

    log.info('-----');
    return (position);
  }, { security: 0, tradeAmount, reserve: 0 });
  if (strategyResult.security > 0) {
    // Sell off any security
    const trade = tradeStub.sell(strategyResult.security, ticker.Ask);
    strategyResult.tradeAmount += trade.total;
  }

  // Buy it during the first value of the crossover
  const nonStrategyBuyTrade = tradeStub.buy(tradeAmount / crossoverData[0].askPrice, crossoverData[0].askPrice);
  const security = nonStrategyBuyTrade.security;

  // Sell it for the current asking price
  const nonStrategySellTrade = tradeStub.sell(security, ticker.Ask);
  tradeAmount = nonStrategySellTrade.total;

  // Generate a file with all the buy and sell points.
  const strategyResultDataFile = 'strategyResultData.txt';
  const strategyResultData = crossoverData.map(crossoverPoint => `${helper.cleanBittrexTimestamp(crossoverPoint.timestamp)}, ${(crossoverPoint.trend === 'UP') ? crossoverPoint.bidPrice : crossoverPoint.askPrice},${(crossoverPoint.trend === 'UP') ? '1' : '0'}`).join('\n');

  log.info(`Current balance based on strategy : ${strategyResult.tradeAmount + strategyResult.reserve}, Current balance if you just bought and sold : ${tradeAmount}`);

  const tradeHistoryDataFile = 'tradeHistory.txt';
  const matLabFile = 'plotTradeHistory.m';

  // Get the market history to plot the data
  const toTimestamp = new Date().getTime();
  const fromTimestamp24 = toTimestamp - (3600000 * 24); // 24 hours

  const marketHistoryData = await getMarketHistory(config.get('bittrexMarket'), fromTimestamp24, toTimestamp, 'bittrexCache');
  const filteredData = helper.getSoldPricesBetweenPeriod(marketHistoryData,
    fromTimestamp24,
    toTimestamp);

  const timestamps = _.map(filteredData, object =>
    helper.cleanBittrexTimestamp(object.TimeStamp));
  log.info(`Timestamps between ${new Date(Math.min(...timestamps))} and ${new Date(Math.max(...timestamps))} for about ${(Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60)} hours`);

  const tradeHistoryData = _.map(filteredData, object => `${helper.cleanBittrexTimestamp(object.TimeStamp)},${object.Price}`).join('\n');
  const matLabInsructions = `
    cd ${process.cwd()}
    tradeHistory=load("${tradeHistoryDataFile}");
    buySellPoints=load("${strategyResultDataFile}");
    figure('Color',[0.8 0.8 0.8])
    plot(tradeHistory(:,1),tradeHistory(:,2),'-k.')

    hold on
    buySellTimestamps = buySellPoints(:,1)
    buySellPrices = buySellPoints(:, 2)
    buyOrSell = buySellPoints(:,3)

    % Plot sell points
    scatter(buySellTimestamps(buyOrSell == 1), buySellPrices(buyOrSell == 1), 50, 'b', 's')

    % Plot buy points

    scatter(buySellTimestamps(buyOrSell == 0), buySellPrices(buyOrSell == 0), 50, 'r', 'o')
    hold off
    startTime=datestr(tradeHistory(1, 1)/86400/1000 + datenum(1970,1,1))
    endTime=datestr(tradeHistory(end, 1)/86400/1000 + datenum(1970,1,1))
    middleTime=datestr(tradeHistory(ceil(end/2), 1)/86400/1000 + datenum(1970,1,1))
    text(tradeHistory(ceil(end/2), 1), tradeHistory(ceil(end/2), 2),middleTime,'Color','red')
    text(tradeHistory(1, 1), tradeHistory(ceil(end/2), 2), startTime,'Color','red')
    text(tradeHistory(end, 1), tradeHistory(ceil(end/2), 2), endTime,'Color','red')
    % movingAverageRef = refline([0 mean(tradeHistory(:,2))])
    % movingAverageRef.Color = 'g'
    % text(tradeHistory(1, 1), mean(tradeHistory(:,2)), num2str(mean(tradeHistory(:,2))),'Color','green')
  `;

  const fileWriteTasks = [
    new Promise(async resolveWrite => fs.writeFile(tradeHistoryDataFile, tradeHistoryData, resolveWrite)),
    new Promise(async resolveWrite => fs.writeFile(strategyResultDataFile, strategyResultData, resolveWrite)),
    new Promise(async resolveWrite => fs.writeFile(matLabFile, matLabInsructions, resolveWrite)),
  ];

  await Promise.all(fileWriteTasks);

  log.info('Done!');
})();
