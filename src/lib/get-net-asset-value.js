const getBalances = require('./get-balances');
const request = require('request');
const _ = require('lodash');

const getNetAssetValue = fiatCurrency => new Promise(
  async (resolveGetNetAssetValue, rejectGetNetAssetValue) => {
    const url = `https://api.coinmarketcap.com/v1/ticker/?convert=${fiatCurrency}`;
    try {
      const bittrexBalances = await getBalances();
      const netAssetValue = await (new Promise(
        (resolve, reject) => request({ url },
          (error, response) => {
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

            const wantedCurrencies = _.filter(jsonBody, currency => _.includes(
              bittrexBalances.map(account => account.Currency), currency.symbol));
            const currencyPriceMatrix = {};
            wantedCurrencies.map(currency => {
              return currencyPriceMatrix[currency.symbol] = currency[`price_${fiatCurrency.toLowerCase()}`];
            });

            return resolve(bittrexBalances.reduce(
              (accumulatedBalance, currentBalance) => currencyPriceMatrix[currentBalance.Currency] * currentBalance.Balance));
          })));

      return resolveGetNetAssetValue(netAssetValue);
    } catch (error) {
      return rejectGetNetAssetValue(error);
    }
  });

module.exports = getNetAssetValue;
