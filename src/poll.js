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
const midPeriod = config.get('strategy.midPeriod');
const longPeriod = config.get('strategy.longPeriod');

const redisClient = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

const poll = market => new Promise(async (resolvePoll) => {
  try {
    // Get the short moving average from bittrex
    // & longer moving average from the cache or bittrex
    const toTimestamp = new Date().getTime();
    const fromTimestampShort = toTimestamp - shortPeriod;
    const fromTimestampMid = toTimestamp - midPeriod;
    const fromTimestampLong = toTimestamp - longPeriod;

    const tasks = [
      getTicker(market),
      movingAverage(market, fromTimestampShort, toTimestamp),
      movingAverage(market, fromTimestampMid, toTimestamp, 'bittrexCache'),
      movingAverage(market, fromTimestampLong, toTimestamp, 'bittrexCache'),
    ];

    const [
      ticker,
      movingAverageShort,
      movingAverageMid,
      movingAverageLong,
    ] = await Promise.all(tasks);

    // Publish to a rules message queue
    redisClient.publish('facts', JSON.stringify({ movingAverageLong, movingAverageMid, movingAverageShort }));
    const movingAverages = {};
    if (movingAverageShort > movingAverageMid) {
      movingAverages.trend = 'UP';
    } else {
      movingAverages.trend = 'DOWN';
    }

    if (movingAverageShort <= movingAverageLong) {
      movingAverages.market = 'BEAR';
    }

    movingAverages.bidPrice = ticker.Bid;
    movingAverages.askPrice = ticker.Ask;

    if (_.isEqual(movingAverages, previousMovingAverages)) {
      return;
    }

    if (_.has(previousMovingAverages, 'trend') && movingAverages.trend !== previousMovingAverages.trend) {
      // Cache recommendation
      const crossoverData = {
        movingAverageShort,
        movingAverageMid,
        movingAverageLong,
        trend: movingAverages.trend,
        bidPrice: movingAverages.bidPrice,
        askPrice: movingAverages.askPrice,
        timestamp: new Date(),
      };

      if (_.has(movingAverages, 'market')) {
        crossoverData.market = movingAverages.market;
      }

      await redisClient.zadd([`${market}-crossovers`, new Date().getTime(), `${JSON.stringify(crossoverData)}`]);

      // Crossover point
      log.info('poll, trend:  Crossover');
    }
    previousMovingAverages = _.cloneDeep(movingAverages);

    log.info(`poll, movingAverageShort(${helper.millisecondsToHours(shortPeriod)}), ${new Date()}:  ${movingAverageShort}`);
    log.info(`poll, movingAverageMid(${helper.millisecondsToHours(midPeriod)}), ${new Date()}:  ${movingAverageMid}`);
    log.info(`poll, movingAverageLong(${helper.millisecondsToHours(longPeriod)}), ${new Date()}:  ${movingAverageLong}`);
    log.info(`poll, movingAverages : ${market} trending ${movingAverages.trend} at price bid:${movingAverages.bidPrice}, ask:${movingAverages.askPrice}`);
    if (_.has(movingAverages, 'market')) {
      log.info(`poll, market : ${movingAverages.market}`);
    }
    resolvePoll(movingAverages);
  } catch (pollError) {
    log.error(`poll, error: ${pollError}`);
  }
});

setInterval(() => poll('USDT-ETH'), 5000);
