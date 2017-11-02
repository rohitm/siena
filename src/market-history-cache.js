const getBittrexMarketHistory = require('./lib/get-bittrex-market-history');
const _ = require('lodash');
const redis = require('redis');
const bunyan = require('bunyan');
const bluebird = require('bluebird');
const express = require('express');
const config = require('config');

const log = bunyan.createLogger({ name: 'market-history-cache' });

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const redisClient = redis.createClient();
redisClient.on('error', redisError => log.error(redisError));

const cacheMarketHistory = (market, periodInMilliseconds) => new Promise(
  async (resolveCache, rejectCache) => {
    try {
      // Get the one hour moving average from bittrex
      let history = await getBittrexMarketHistory(market);

      // Select unique transaction Ids
      history = _.uniqBy(history, 'Id');

      // Sort it by the transaction time
      history = _.sortBy(history, [
        object => Date.parse(((object.TimeStamp.slice(-1) !== 'Z') ? `${object.TimeStamp}Z` : object.TimeStamp)),
      ]).reverse();

      // TODO: Cache them in redis
      const redisZAddParams = history.reduce((acc, object) => {
        const timestamp = Date.parse(((object.TimeStamp.slice(-1) !== 'Z') ? `${object.TimeStamp}Z` : object.TimeStamp));
        return [...acc, timestamp, JSON.stringify(object)];
      }, [market]);

      // Add to the cache
      await redisClient.zadd(redisZAddParams);
      log.info(`cacheMarketHistory: ${history.length} transactions cached`);

      // Clean up the cache
      const cacheLowerLimitTimestamp = new Date().getTime() - periodInMilliseconds;
      log.info(`cacheMarketHistory, periodInMilliseconds, cacheLowerLimitTimestamp: ${periodInMilliseconds}, ${new Date(cacheLowerLimitTimestamp)}`);
      log.info(`cacheMarketHistory: Cleaning cache with redis code : 'ZREMRANGEBYSCORE ${market} -inf ${cacheLowerLimitTimestamp}'`);
      await redisClient.zremrangebyscore([market, '-inf', cacheLowerLimitTimestamp]);

      resolveCache(true);
    } catch (cacheMarketHistoryError) {
      log.error(`cacheMarketHistory: ${cacheMarketHistoryError}`);
      rejectCache(cacheMarketHistoryError);
    }
  });

const getMarketHistory = market => new Promise(async (resolveGet, rejectGet) => redisClient.zrange([market, '0', '-1'], (error, data) => {
  if (error) {
    return rejectGet(error);
  }

  // Convert the objects into strings
  return resolveGet(data.map(JSON.parse));
}));

const getCrossovers = market => new Promise(async (resolveGet, rejectGet) => redisClient.zrange([`${market}-crossovers`, '0', '-1'], (error, data) => {
  if (error) {
    return rejectGet(error);
  }

  // Convert the objects into strings
  return resolveGet(data.map(JSON.parse));
}));

// Cache Every 15 mins
log.info(`marketHistoryCache: Polling bittrex for history every ${config.get('pollIntervalMinutes')} minutes, cache length = ${config.get('cachePeriodInHours')} hours`);
setInterval(() => cacheMarketHistory(config.get('bittrexMarket'), (3600000 * config.get('cachePeriodInHours'))), config.get('pollIntervalMinutes') * 60 * 1000);

const app = express();

app.get('/getMarketHistory', async (req, res) => {
  res.set('Content-Type', 'application/json');

  if (!_.has(req, 'query.market')) {
    return res.send({ success: false, message: 'need market' });
  }

  return res.send({ success: true, result: await getMarketHistory(req.query.market) });
});

app.get('/getCrossovers', async (req, res) => {
  res.set('Content-Type', 'application/json');

  if (!_.has(req, 'query.market')) {
    return res.send({ success: false, message: 'need market' });
  }

  return res.send({ success: true, result: await getCrossovers(req.query.market) });
});

app.listen(config.get('cacheServerPort'));
log.info(`marketHistoryCache: Server started on port ${config.get('cacheServerPort')}`);
