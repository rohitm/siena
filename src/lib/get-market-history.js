const request = require('request');
const config = require('config');

const getMarketHistory = (market, fromTimestamp, toTimestamp, source = 'bittrex') =>
  new Promise((resolveGetMarketHistory, rejectGetMarketHistory) =>
    request(`${config.get(`${source}.getmarkethistoryurl`)}?market=${market}`, (error, response, body) => {
      if (error) {
        return rejectGetMarketHistory(error);
      }

      if (response.body === undefined) {
        return rejectGetMarketHistory(new Error('Empty body'));
      }

      let jsonBody;
      try {
        jsonBody = JSON.parse(response.body);
      } catch (jsonParseError) {
        return rejectGetMarketHistory(jsonParseError);
      }

      if (jsonBody.success !== true) {
        return rejectGetMarketHistory(new Error(jsonBody.message || 'Unknown error'));
      }

      return resolveGetMarketHistory(jsonBody.result);
    }));

module.exports = getMarketHistory;
