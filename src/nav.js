const config = require('config');
const bunyan = require('bunyan');
const getNetAssetValue = require('./lib/get-net-asset-value');
const getBalances = require('./lib/get-balances');

const log = bunyan.createLogger({ name: 'nav' });

(async () => {
  const tasks = [
    getNetAssetValue(),
    getBalances(),
  ];
  const [nav, bittrexBalances] = await Promise.all(tasks);
  log.info(bittrexBalances);
  log.info(`The current net asset value of your bittrex account trading with the ${config.get('bittrexMarket')} market is $${nav} USD`);
})();
