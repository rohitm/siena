const request = require('request');
const config = require('config');

const getRange = (market, source = 'bittrex') => new Promise(async (resolveGetRange, rejectGetRange) => {
  const url = `${config.get(`${source}.getmarketsummaryurl`)}?market=${market}`;

  try {
    const marketSummary = await (new Promise((resolve, reject) =>
      request(url, (error, response) => {
        if (error) {
          return reject(error);
        }

        if (response.body === undefined) {
          return reject(new Error('Empty body'));
        }

        let jsonBody;
        try {
          jsonBody = JSON.parse(response.body);
        } catch (jsonParseError) {
          return reject(jsonParseError);
        }

        if (jsonBody.success !== true) {
          return reject(new Error(jsonBody.message || 'Unknown error'));
        }

        return resolve(jsonBody.result);
      })));

    if (marketSummary.length === 0) {
      return rejectGetRange(new Error('Markets not returned'));
    }

    if (marketSummary[0].MarketName === undefined ||
      marketSummary[0].High === undefined ||
      marketSummary[0].Low === undefined ||
      marketSummary[0].MarketName !== market
    ) {
      return rejectGetRange(new Error('Market data not returned'));
    }

    // Modulus isn't support in es6 off the bat
    const range = Math.sqrt((parseFloat(marketSummary[0].Low) - parseFloat(marketSummary[0].High))
      ** 2);

    return resolveGetRange(range);
  } catch (error) {
    return rejectGetRange(error);
  }
});

module.exports = getRange;
