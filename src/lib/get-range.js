const getMarketSummary = require('./get-market-summary');

const getRange = (market, source = 'bittrex') => new Promise(async (resolveGetRange, rejectGetRange) => {
  try {
    const marketSummary = await getMarketSummary(market, source);

    // Modulus isn't support in es6 off the bat
    const range = Math.sqrt((parseFloat(marketSummary.Low) - parseFloat(marketSummary.High))
      ** 2);

    return resolveGetRange(range);
  } catch (error) {
    return rejectGetRange(error);
  }
});

module.exports = getRange;
