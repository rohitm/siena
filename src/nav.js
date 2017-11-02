const config = require('config');
const bunyan = require('bunyan');
const getNetAssetValue = require('./lib/get-net-asset-value');

const log = bunyan.createLogger({ name: 'nav' });

(async () => {
  const nav = await getNetAssetValue();
  log.info(`The current net asset value of your bittrex account trading with the ${config.get('bittrexMarket')} market is $${nav} USD`);
})();
