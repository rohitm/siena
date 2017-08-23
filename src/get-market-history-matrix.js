const getMarketHistory = require('./lib/get-market-history');
const helper = require('./helper');
const _ = require('lodash');
const fs = require('fs');
const logger = require('cli-logger');

const log = logger({ level: logger.INFO });

(async () => {
  try {
    const market = 'USDT-ETH';
    const matLabDataFile = 'tradeHistory.txt';
    const matLabFile = 'plotTradeHistory.m';

    // Get 24 market history
    const toTimestamp = new Date().getTime();
    const fromTimestamp24 = toTimestamp - (3600000 * 24); // 24 hours

    const data = await getMarketHistory(market, fromTimestamp24, toTimestamp, 'bittrexCache');
    const filteredData = helper.getSoldPricesBetweenPeriod(data, fromTimestamp24, toTimestamp);

    const timestamps = _.map(filteredData, object =>
      helper.cleanBittrexTimestamp(object.TimeStamp));
    log.info(`Timestamps between ${new Date(Math.min(...timestamps))} and ${new Date(Math.max(...timestamps))}`);

    const fileData = _.map(filteredData, object => `${helper.cleanBittrexTimestamp(object.TimeStamp)},${object.Price}`).join('\n');
    const matLabInsructions = [
      `cd ${process.cwd()}`,
      `tradeHistory=load("${matLabDataFile}");`,
      'plot(tradeHistory(:,1),tradeHistory(:,2),\'-x\')',
      'startTime=datestr(tradeHistory(1, 1)/86400/1000 + datenum(1970,1,1))',
      'endTime=datestr(tradeHistory(end, 1)/86400/1000 + datenum(1970,1,1))',
      'middleTime=datestr(tradeHistory(ceil(end/2), 1)/86400/1000 + datenum(1970,1,1))',
      'text(tradeHistory(ceil(end/2), 1), tradeHistory(ceil(end/2), 2),middleTime,\'Color\',\'red\')',
      'text(tradeHistory(1, 1), tradeHistory(ceil(end/2), 2),startTime,\'Color\',\'red\')',
      'text(tradeHistory(end, 1), tradeHistory(ceil(end/2), 2),endTime,\'Color\',\'red\')',
    ].join('\n');

    await new Promise(async resolveWrite => fs.writeFile(matLabDataFile, fileData, resolveWrite));
    await new Promise(async resolveWrite =>
      fs.writeFile(matLabFile, matLabInsructions, resolveWrite));

    log.info('Done!');
  } catch (pollError) {
    log.error(pollError);
  }
})();
