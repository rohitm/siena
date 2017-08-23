const _ = require('lodash');
const getMarketHistory = require('./get-market-history');

const getMovingAverage = (market, fromTimestamp, toTimestamp, source) =>
  new Promise(async (resolveMovingAverage, rejectMovingAverage) => {
    try {
      const data = await getMarketHistory(market, fromTimestamp, toTimestamp, source);

      const filteredData = _.filter(data, (object) => {
        const sellTimestamp = Date.parse(((object.TimeStamp.slice(-1) !== 'Z') ? `${object.TimeStamp}Z` : object.TimeStamp));

        if (object.FillType === 'FILL'
        && object.OrderType === 'SELL'
        && sellTimestamp <= toTimestamp
        && sellTimestamp >= fromTimestamp) {
          return (object);
        }

        return (null);
      });

      const movingAverage = filteredData.reduce((sum, object) =>
        (sum + parseFloat(object.Price)), 0) / filteredData.length;
      return resolveMovingAverage(movingAverage);
    } catch (error) {
      return rejectMovingAverage(error);
    }
  });

module.exports = getMovingAverage;
