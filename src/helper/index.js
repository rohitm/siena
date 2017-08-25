const _ = require('lodash');

const cleanBittrexTimestamp = bittrexTimestamp => Date.parse(((bittrexTimestamp.slice(-1) !== 'Z') ? `${bittrexTimestamp}Z` : bittrexTimestamp));

const getSoldPricesBetweenPeriod = (marketData, fromTimestamp, toTimestamp) =>
  _.filter(marketData, (object) => {
    const sellTimestamp = cleanBittrexTimestamp(object.TimeStamp);

    if (object.FillType === 'FILL'
    && object.OrderType === 'SELL'
    && sellTimestamp <= toTimestamp
    && sellTimestamp >= fromTimestamp) {
      return (object);
    }

    return (null);
  });

const millisecondsToHours = milliseconds => ((milliseconds > 3600000) ? `${(milliseconds / 3600000).toFixed('1')} hours` : `${(milliseconds / 60000).toFixed('1')} minutes`);

module.exports.cleanBittrexTimestamp = cleanBittrexTimestamp;
module.exports.getSoldPricesBetweenPeriod = getSoldPricesBetweenPeriod;
module.exports.millisecondsToHours = millisecondsToHours;
