const request = require('request');
const logger = require('cli-logger');

const log = logger({ level: logger.INFO });

const getBittrexMarketHistory = market => new Promise(async (resolveHistory, rejectHistory) => request(`https://bittrex.com/api/v1.1/public/getmarkethistory?market=${market}`, (error, response) => {
  if (error) {
    return rejectHistory(error);
  }

  if (response.body === undefined) {
    return rejectHistory(new Error('Empty body'));
  }

  let jsonBody;
  try {
    jsonBody = JSON.parse(response.body);
  } catch (jsonParseError) {
    return rejectHistory(jsonParseError);
  }

  if (jsonBody.success !== true) {
    log.error(`getBittrexMarketHistory: Non success response ${JSON.stringify(jsonBody)}, market=${market}`);
    return rejectHistory(new Error(jsonBody.message || 'Unknown error'));
  }

  return resolveHistory(jsonBody.result);
}));


module.exports = getBittrexMarketHistory;
