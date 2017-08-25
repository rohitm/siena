const movingAverage = require('./lib/moving-average');
const getTicker = require('./lib/get-ticker');
const logger = require('cli-logger');
const _ = require('lodash');
const redis = require('redis');
const config = require('config');
const helper = require('./helper');

const log = logger({ level: logger.INFO });
let previousRecommendation;
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
    const recommendation = {};
    if (movingAverageShort > movingAverageLong) {
      recommendation.action = 'BUY';
      recommendation.buyPrice = ticker.Ask;
    } else {
      recommendation.action = 'SELL';
      recommendation.sellPrice = ticker.Bid;
    }

    if (_.isEqual(recommendation, previousRecommendation)) {
      return;
    }

    if (_.has(previousRecommendation, 'action')) {
      log.info(`${previousRecommendation.action}, ${recommendation.action}`);
    }
    if (_.has(previousRecommendation, 'action') && recommendation.action !== previousRecommendation.action) {
      // Cache recommendation
      await redisClient.sadd([`${market}-crossovers`, `${JSON.stringify({ movingAverageShort, movingAverageLong, action: recommendation.action, price: (recommendation.buyPrice || recommendation.sellPrice), timestamp: new Date().getTime() })}`]);

      // Crossover point
      log.info('poll, recommendation:  CROSSOVER');
    }
    previousRecommendation = _.cloneDeep(recommendation);

    log.info(`poll, movingAverageShort(${helper.millisecondsToHours(shortPeriod)}), ${new Date()}:  ${movingAverageShort}`);
    log.info(`poll, movingAverageLong(${helper.millisecondsToHours(longPeriod)}), ${new Date()}:  ${movingAverageLong}`);
    log.info(`poll, recommendation : ${recommendation.action} currency in ${market} at price ${(recommendation.buyPrice || recommendation.sellPrice)}`);
    resolvePoll(recommendation);
  } catch (pollError) {
    log.error(`poll, error: ${pollError}`);
    if (pollError.message === 'Not enough market data') {
      shortPeriod += config.get('strategy.periodIncreaseMilliseconds');
      log.info(`poll, increased short period: ${helper.millisecondsToHours(shortPeriod)}, ${new Date()}`);
    }
  }
});

setInterval(() => poll('USDT-ETH'), 1000);
