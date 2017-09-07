const getBalances = require('./get-balances');
const request = require('request');
const _ = require('lodash');

const getNetAssetValue = (fiatCurrency = 'USD') => new Promise(
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

            const currencyPriceMatrix = wantedCurrencies.map((currency) => {
              const returnObj = {};
              returnObj[`${currency.symbol}`] = currency[`price_${fiatCurrency.toLowerCase()}`];
              return returnObj;
            }).reduce((accumulatedCurrencyPriceMatrix, fiatCurrencyPrice) => {
              const returnArray = [];
              returnArray[_.keys(fiatCurrencyPrice)[0]] = _.values(fiatCurrencyPrice)[0];
              return _.merge(returnArray, accumulatedCurrencyPriceMatrix);
            }, {});

            return resolve(bittrexBalances.reduce(
              (accumulatedBalance, currentBalance) => (accumulatedBalance + (
                currencyPriceMatrix[currentBalance.Currency] * currentBalance.Balance))
              , 0).toFixed(2));
          })));

      return resolveGetNetAssetValue(netAssetValue);
    } catch (error) {
      return rejectGetNetAssetValue(error);
    }
  });

module.exports = getNetAssetValue;
