const getMarketHistory = require('./lib/get-market-history');
const helper = require('./helper');
const _ = require('lodash');

(async () => {
  try {
    const market = 'USDT-ETH';
    // Get 24 market history
    const toTimestamp = new Date().getTime();
    const fromTimestamp24 = toTimestamp - (3600000 * 24); // 24 hours

    const data = await getMarketHistory(market, fromTimestamp24, toTimestamp, 'bittrexCache');
    const filteredData = helper.getSoldPricesBetweenPeriod(data, fromTimestamp24, toTimestamp);

    const timestamps = _.map(filteredData, object => helper.cleanBittrexTimestamp(object.TimeStamp));
    console.log(`Timestamps between ${new Date(Math.min(...timestamps))} and ${new Date(Math.max(...timestamps))}`);
  } catch (pollError) {
    console.log(pollError);
  }
})();
