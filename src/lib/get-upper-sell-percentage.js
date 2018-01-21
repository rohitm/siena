const getMarketSummary = require('./get-market-summary');
const config = require('config');


const getUpperSellPercentage = async (buyPrice) => {
  try {
    const marketSummary = await getMarketSummary(config.get('bittrexMarket'));

    const price = parseFloat(buyPrice);
    let percentage = ((parseFloat(marketSummary.High) - price) / price) / 2;
    if (percentage < config.get('strategy.upperSellPercentage') || !isFinite(percentage)) {
      percentage = config.get('strategy.upperSellPercentage');
    }

    return percentage;
  } catch (error) {
    throw error;
  }
};

module.exports = getUpperSellPercentage;
