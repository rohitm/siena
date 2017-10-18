const movingAverage = require('./lib/moving-average');
const logger = require('cli-logger');
const redis = require('redis');
const config = require('config');

const log = logger({ level: logger.INFO });

const shortPeriod = config.get('strategy.shortPeriod');
const midPeriod = config.get('strategy.midPeriod');
const longPeriod = config.get('strategy.longPeriod');

const redisClient = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

const poll = market => new Promise(async (resolvePoll, rejectPoll) => {
  try {
    // Get the short moving average from bittrex
    // & longer moving average from the cache or bittrex
    const toTimestamp = new Date().getTime();
    const fromTimestampShort = toTimestamp - shortPeriod;
    const fromTimestampMid = toTimestamp - midPeriod;
    const fromTimestampLong = toTimestamp - longPeriod;

    const tasks = [
      movingAverage(market, fromTimestampShort, toTimestamp),
      movingAverage(market, fromTimestampMid, toTimestamp, 'bittrexCache'),
      movingAverage(market, fromTimestampLong, toTimestamp, 'bittrexCache'),
    ];

    const [
      movingAverageShort,
      movingAverageMid,
      movingAverageLong,
    ] = await Promise.all(tasks);

    // Publish to a rules message queue
    redisClient.publish('facts', JSON.stringify({ movingAverageLong, movingAverageMid, movingAverageShort }));
    resolvePoll({ movingAverageLong, movingAverageMid, movingAverageShort });
  } catch (pollError) {
    log.error(`poll, error: ${pollError}`);
    rejectPoll(pollError);
  }
});

module.exports = poll;
