const movingAverage = require('./lib/moving-average');
const getTicker = require('./lib/get-ticker');
const logger = require('cli-logger');
const _ = require('lodash');
const redis = require('redis');
const config = require('config');
const helper = require('./helper');

const log = logger({ level: logger.INFO });
let previousMovingAverages;
const shortPeriod = config.get('strategy.shortPeriod');
const longPeriod = config.get('strategy.longPeriod');

const redisClient = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

const poll = market => new Promise(async (resolvePoll) => {
  try {
    // Get the short moving average from bittrex
    // & longer moving average from the cache or bittrex
    const toTimestamp = new Date().getTime();
    const fromTimestampShort = toTimestamp - shortPeriod;
    const fromTimestampLong = toTimestamp - longPeriod;

    const tasks = [
      getTicker(market),
      movingAverage(market, fromTimestampShort, toTimestamp),
      movingAverage(market, fromTimestampLong, toTimestamp, 'bittrexCache'),
    ];

    const [ticker, movingAverageShort, movingAverageLong] = await Promise.all(tasks);

    // TODO : Publish to events or rules queue
    const movingAverages = {};
    if (movingAverageShort > movingAverageLong) {
      movingAverages.trend = 'UP';
    } else {
      movingAverages.trend = 'DOWN';
    }
    movingAverages.bidPrice = ticker.Bid;
    movingAverages.askPrice = ticker.Ask;

    if (_.isEqual(movingAverages, previousMovingAverages)) {
      return;
    }

    if (_.has(previousMovingAverages, 'trend') && movingAverages.trend !== previousMovingAverages.trend) {
      // Cache recommendation
      await redisClient.zadd([`${market}-crossovers`, new Date().getTime(), `${JSON.stringify(
        {
          movingAverageShort,
          movingAverageLong,
          trend: movingAverages.trend,
          bidPrice: movingAverages.bidPrice,
          askPrice: movingAverages.askPrice,
          timestamp: new Date(),
        })}`]);

      // Crossover point
      log.info('poll, trend:  Crossover');
    }
    previousMovingAverages = _.cloneDeep(movingAverages);

    log.info(`poll, movingAverageShort(${helper.millisecondsToHours(shortPeriod)}), ${new Date()}:  ${movingAverageShort}`);
    log.info(`poll, movingAverageLong(${helper.millisecondsToHours(longPeriod)}), ${new Date()}:  ${movingAverageLong}`);
    log.info(`poll, movingAverages : ${market} trending ${movingAverages.trend} at price bid:${movingAverages.bidPrice}, ask:${movingAverages.askPrice}`);
    resolvePoll(movingAverages);
  } catch (pollError) {
    log.error(`poll, error: ${pollError}`);
  }
});

setInterval(() => poll('USDT-ETH'), 5000);
