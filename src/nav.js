const config = require('config');
const logger = require('cli-logger');
const getNetAssetValue = require('./lib/get-net-asset-value');

const log = logger({ level: logger.INFO });

(async () => {
  const nav = await getNetAssetValue();
  log.info(`The current net asset value of your bittrex account trading with the ${config.get('bittrexMarket')} market is $${nav} USD`);
})();
