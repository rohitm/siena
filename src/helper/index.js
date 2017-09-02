const _ = require('lodash');
const config = require('config');

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

// Formula :
// ( Wanted Higher security price * security qty)
// * (1 - bittrex commission) = security qty * actual security price
const adjustSellPriceToCommission = price => price / (1 - config.get('bittrexCommission'));
const adjustBuyPriceToCommission = (amount, quantity) => (amount * (1 - config.get('bittrexCommission'))) / quantity;

module.exports = {
  cleanBittrexTimestamp,
  getSoldPricesBetweenPeriod,
  millisecondsToHours,
  adjustSellPriceToCommission,
  adjustBuyPriceToCommission,
};
