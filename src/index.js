const movingAverage = require('./lib/moving-average');
const getTicker = require('./lib/get-ticker');
const logger = require('cli-logger');
const _ = require('lodash');
const redis = require('redis');

const log = logger({ level: logger.INFO });
let previousRecommendation;
const redisClient = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

const poll = market => new Promise(async (resolvePoll, rejectPoll) => {
  try {
    // Get the one hour moving average from bittrex
    // & 24 hourmoving average from the cache or bittrex
    const toTimestamp = new Date().getTime();
    const fromTimestamp = toTimestamp - (3600000); // One hour
    const fromTimestamp24 = toTimestamp - (3600000 * 24); // 24 hours

    const tasks = [
      getTicker(market),
      movingAverage(market, fromTimestamp, toTimestamp),
      movingAverage(market, fromTimestamp24, toTimestamp, 'bittrexCache'),
    ];

    const [ticker, movingAverageOne, movingAverage24] = await Promise.all(tasks);

    // TODO : Publish to events or rules queue
    const recommendation = {};
    if (movingAverageOne > movingAverage24) {
      recommendation.action = 'BUY';
      recommendation.buyPrice = ticker.Ask;
    } else {
      recommendation.action = 'SELL';
      recommendation.sellPrice = ticker.Bid;
    }

    if (_.isEqual(recommendation, previousRecommendation)) {
      return;
    }
    previousRecommendation = _.cloneDeep(recommendation);

    if (recommendation.action !== previousRecommendation.action) {
      // Cache recommendation
      await redisClient.sadd([`${market}-crossovers`, `${JSON.stringify({ movingAverageOne, movingAverage24, action: recommendation.action, price: (recommendation.buyPrice || recommendation.sellPrice), timestamp: new Date().getTime() })}`]);

      // Crossover point
      log.info('poll, recommendation:  CROSSOVER');
    }

    log.info(`poll, movingAverageOne, ${new Date()}:  ${movingAverageOne}`);
    log.info(`poll, movingAverage24, ${new Date()}:  ${movingAverage24}`);
    log.info(`poll, recommendation : ${recommendation.action} currency in ${market} at price ${(recommendation.buyPrice || recommendation.sellPrice)}`);
  } catch (pollError) {
    log.error(`poll, error: ${pollError}`);
    rejectPoll(pollError);
  }
});

setInterval(() => poll('USDT-ETH'), 1000);
