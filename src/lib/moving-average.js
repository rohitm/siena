const getMarketHistory = require('./get-market-history');
const helper = require('../helper');

const getMovingAverage = (market, fromTimestamp, toTimestamp, source) =>
  new Promise(async (resolveMovingAverage, rejectMovingAverage) => {
    try {
      const data = await getMarketHistory(market, fromTimestamp, toTimestamp, source);

      const filteredData = helper.getSoldPricesBetweenPeriod(data, fromTimestamp, toTimestamp);

      const movingAverage = filteredData.reduce((sum, object) =>
        (sum + parseFloat(object.Price)), 0) / filteredData.length;
      return resolveMovingAverage(movingAverage);
    } catch (error) {
      return rejectMovingAverage(error);
    }
  });

module.exports = getMovingAverage;
