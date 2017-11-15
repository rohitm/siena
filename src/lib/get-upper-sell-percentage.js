const getMarketSummary = require('./get-market-summary');
const config = require('config');


const getUpperSellPercentage = buyPrice =>
  new Promise(async (resolveGetUpperSellPercentage, rejectGetUpperSellPercentage) => {
    try {
      const marketSummary = await getMarketSummary(config.get('bittrexMarket'));

      const price = parseFloat(buyPrice);
      let percentage = ((parseFloat(marketSummary.High) - price) / price) / 2;
      if (percentage < config.get('strategy.upperSellPercentage') || !isFinite(percentage)) {
        percentage = config.get('strategy.upperSellPercentage');
      }

      return resolveGetUpperSellPercentage(percentage);
    } catch (error) {
      return rejectGetUpperSellPercentage(error);
    }
  });

module.exports = getUpperSellPercentage;
