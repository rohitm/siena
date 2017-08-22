const movingAverage = require('./lib/moving-average');

(async () => {
  // Get the one hour moving average from bittrex

  const toTimestamp = new Date().getTime();
  const fromTimestamp = toTimestamp - (3600000); // One hour
  const oneHourMovingAverage = await movingAverage('USDT-ETH', fromTimestamp, toTimestamp);
  console.log(oneHourMovingAverage);
})();
