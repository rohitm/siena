const request = require('request');
const config = require('config');

const getMarketSummary = (market, source = 'bittrex') => new Promise(async (resolveGetMarketSummary, rejectGetMarketSummary) => {
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
      return rejectGetMarketSummary(new Error('Markets not returned'));
    }

    if (marketSummary[0].MarketName === undefined ||
      marketSummary[0].High === undefined ||
      marketSummary[0].Low === undefined ||
      marketSummary[0].MarketName !== market
    ) {
      return rejectGetMarketSummary(new Error('Market data not returned'));
    }

    return resolveGetMarketSummary(marketSummary[0]);
  } catch (error) {
    return rejectGetMarketSummary(error);
  }
});

module.exports = getMarketSummary;
