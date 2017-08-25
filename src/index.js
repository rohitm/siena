const movingAverage = require('./lib/moving-average');
const getTicker = require('./lib/get-ticker');
const logger = require('cli-logger');
const _ = require('lodash');
const redis = require('redis');
const config = require('config');
const helper = require('./helper');

const log = logger({ level: logger.INFO });
let previousMovingAverages;
let shortPeriod = config.get('strategy.shortPeriod');

const redisClient = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

const poll = market => new Promise(async (resolvePoll) => {
  try {
    // Get the short moving average from bittrex
    // & longer moving average from the cache or bittrex
    const toTimestamp = new Date().getTime();
    const fromTimestampShort = toTimestamp - shortPeriod;
    const longPeriod = shortPeriod * config.get('strategy.shortLongPeriodRatio');
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
      movingAverages.buyPrice = ticker.Ask;
    } else {
      movingAverages.trend = 'DOWN';
      movingAverages.sellPrice = ticker.Bid;
    }

    if (_.isEqual(movingAverages, previousMovingAverages)) {
      return;
    }

    if (_.has(previousMovingAverages, 'trend') && movingAverages.trend !== previousMovingAverages.trend) {
      // Cache recommendation
      await redisClient.sadd([`${market}-crossovers`, `${JSON.stringify({ movingAverageShort, movingAverageLong, trend: movingAverages.trend, price: (movingAverages.buyPrice || movingAverages.sellPrice), timestamp: new Date().getTime() })}`]);

      // Crossover point
      log.info('poll, trend:  Crossover');
    }
    previousMovingAverages = _.cloneDeep(movingAverages);

    log.info(`poll, movingAverageShort(${helper.millisecondsToHours(shortPeriod)}), ${new Date()}:  ${movingAverageShort}`);
    log.info(`poll, movingAverageLong(${helper.millisecondsToHours(longPeriod)}), ${new Date()}:  ${movingAverageLong}`);
    log.info(`poll, movingAverages : ${market} trending ${movingAverages.trend} at price ${(movingAverages.buyPrice || movingAverages.sellPrice)}`);
    resolvePoll(movingAverages);
  } catch (pollError) {
    log.error(`poll, error: ${pollError}`);
    if (pollError.message === 'Not enough market data') {
      shortPeriod += config.get('strategy.periodIncreaseMilliseconds');
      log.info(`poll, increased short period: ${helper.millisecondsToHours(shortPeriod)}, ${new Date()}`);
    }
  }
});

setInterval(() => poll('USDT-ETH'), 1000);
