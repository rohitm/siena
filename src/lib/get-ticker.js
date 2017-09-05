const request = require('request');
const config = require('config');

const getTicker = (market, source = 'bittrex') => new Promise(async (resolveGetTicker, rejectGetTicker) => {
  const url = `${config.get(`${source}.gettickerurl`)}?market=${market}`;

  try {
    const ticker = await (new Promise((resolve, reject) => request(url, (error, response, body) => {
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

    return resolveGetTicker(ticker);
  } catch (error) {
    return rejectGetTicker(error);
  }
});

module.exports = getTicker;
