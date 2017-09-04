const request = require('request');
const config = require('config');
const crypto = require('crypto');

const getBalances = () => new Promise(async (resolveGetBalances, rejectGetBalances) => {
  const url = `${config.get('bittrex.getbalancesurl')}?apikey=${config.get('bittrexApiKey')}&nonce=${new Date().getTime()}`;
  const apisign = crypto.createHmac('sha512', config.get('bittrexApiSecret')).update(url).digest('hex');

  try {
    const balances = await (
      new Promise((resolve, reject) => request({ url, headers: { apisign } },
        (error, response, body) => {
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
            return reject(new Error(body.message || 'Unknown error'));
          }

          return resolve(jsonBody.result);
        })));

    return resolveGetBalances(balances);
  } catch (error) {
    return rejectGetBalances(error);
  }
});

module.exports = getBalances;
