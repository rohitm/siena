const request = require('request');
const _ = require('lodash');

const getMovingAverage = (market, fromTimestamp, toTimestamp, source = 'bitrex') => new Promise(async (resolveMovingAverage, rejectMovingAverage) => {
  let url;
  if (source === 'bitrex') {
    url = `https://bittrex.com/api/v1.1/public/getmarkethistory?market=${market}`;
  }

  try {
    const data = await (new Promise((resolve, reject) => request(url, (error, response, body) => {
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

    const filteredData = _.filter(data, (object) => {
      const sellTimestamp = Date.parse(((object.TimeStamp.slice(-1) !== 'Z') ? `${object.TimeStamp}Z` : object.TimeStamp));

      if (object.FillType === 'FILL'
      && object.OrderType === 'SELL'
      && sellTimestamp <= toTimestamp
      && sellTimestamp >= fromTimestamp) {
        return (object);
      }

      return (null);
    });

    const movingAverage = filteredData.reduce((sum, object) =>
      (sum + parseFloat(object.Price)), 0) / filteredData.length;
    return resolveMovingAverage(movingAverage);
  } catch (error) {
    return rejectMovingAverage(error);
  }
});

module.exports = getMovingAverage;
