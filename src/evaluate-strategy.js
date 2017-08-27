const request = require('request');
const logger = require('cli-logger');
const config = require('config');
const getTicker = require('./lib/get-ticker');

const log = logger({ level: logger.INFO });

const getCrossovers = market => new Promise(async (resolveGetCrossovers, rejectGetCrossovers) => request(`${config.get('bittrexCache.getcrossoverurl')}?market=${market}`, (error, response) => {
  if (error) {
    return rejectGetCrossovers(error);
  }

  if (response.body === undefined) {
    return rejectGetCrossovers(new Error('Empty body'));
  }

  let jsonBody;
  try {
    jsonBody = JSON.parse(response.body);
  } catch (jsonParseError) {
    return rejectGetCrossovers(jsonParseError);
  }

  return resolveGetCrossovers(jsonBody.result);
}));

(async () => {
  const tasks = [
    getTicker(config.get('bittrexMarket')),
    getCrossovers(config.get('bittrexMarket')),
  ];

  const [ticker, data] = await Promise.all(tasks);


  let tradeAmount = 1000; // How much currency you have to trade
  const strategyResult = data.reduce((accumatedPosition, crossoverPoint) => {
    const position = accumatedPosition;

    if (crossoverPoint.trend === 'DOWN' && position.tradeAmount > 0) {
      // Buy
      position.security = position.tradeAmount / crossoverPoint.price;
      log.info(`Buy ${position.security} for ${position.tradeAmount} at ${crossoverPoint.price}`);
      position.tradeAmount = 0;
    } else if (crossoverPoint.trend === 'UP' && position.security > 0) {
      // Sell
      position.tradeAmount = position.security * crossoverPoint.price;
      log.info(`Sell ${position.security} at ${crossoverPoint.price}`);
      position.security = 0;
    }

    return (position);
  }, { security: 0, tradeAmount });
  if (strategyResult.security > 0) {
    strategyResult.tradeAmount += strategyResult.security * ticker.Ask;
  }

  // Buy it during the first value of the crossover
  const security = tradeAmount / data[0].price;

  // Sell it on the current asking price
  tradeAmount = security * ticker.Ask;

  log.info(`Current balance based on strategy : ${strategyResult.tradeAmount}, Current balance if you just bought and sold : ${tradeAmount}`);
})();
