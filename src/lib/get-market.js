const request = require('request');
const config = require('config');

const getMarket = (baseCurrency, securityCurrency, source = 'bittrex') => new Promise(async (resolveGetMarket, rejectGetMarket) => {
  const url = `${config.get(`${source}.getmarketsurl`)}`;

  try {
    const markets = await (new Promise((resolve, reject) =>
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

    if (markets.length === 0) {
      return rejectGetMarket(new Error('Markets not returned'));
    }

    const market = markets.filter(thisMarket =>
      (thisMarket.BaseCurrency === baseCurrency &&
        thisMarket.MarketCurrency === securityCurrency));
    return resolveGetMarket(market[0]);
  } catch (error) {
    return rejectGetMarket(error);
  }
});

module.exports = getMarket;
