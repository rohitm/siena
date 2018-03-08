const getBalances = require('./lib/get-balances');
const getTicker = require('./lib/get-ticker');
const config = require('config');
const Account = require('./lib/account');
const sellLimit = require('./lib/sell-limit');
const tradeStub = require('./lib/trade-stub');
const bunyan = require('bunyan');

const log = bunyan.createLogger({ name: 'sell-everything' });

const sellSecurity = async () => {
  const sienaAccount = new Account();
  const tasks = [
    getBalances(),
    getTicker(config.get('bittrexMarket')),
  ];

  let ticker;
  let bittrexBalances;
  try {
    [bittrexBalances, ticker] = await Promise.all(tasks);
  } catch (err) {
    log.error(`sellSecurity, Error : ${err}`);
    return (false);
  }

  sienaAccount.setBittrexBalance(bittrexBalances);

  const securityQuantity = sienaAccount.getBittrexBalance();
  if (securityQuantity <= 0) {
    log.error('sellSecurity Error: No security to Sell');
    return (false);
  }

  log.info({
    type: 'tradeHistory',
    timestamp: new Date().getTime(),
    price: ticker.Bid,
    buyOrSell: 1,
  });
  log.info(`sellSecurity: Sell ${securityQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Bid}`);
  const order = await sellLimit(config.get('bittrexMarket'), securityQuantity, ticker.Bid);
  log.info(`sellSecurity, sellOrderUuid: ${order.uuid}`);
  tradeStub.sell(securityQuantity, ticker.Bid);

  // Assume that this order gets filled and then update the balance
  return (true);
};

sellSecurity();
