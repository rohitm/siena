const getBalances = require('./lib/get-balances');
const getTicker = require('./lib/get-ticker');
const Account = require('./lib/account');
const tradeStub = require('./lib/trade-stub');
const buyLimit = require('./lib/buy-limit');
const config = require('config');
const bunyan = require('bunyan');

const sienaAccount = new Account();
const log = bunyan.createLogger({ name: 'siena-setup' });

(async () => {
  const balances = await getBalances();
  sienaAccount.setBittrexBalance(balances);
  // Make sure crypto wallet balances are present for your configured currencies.
  let baseCurrencyWalletBalance;
  try {
    baseCurrencyWalletBalance = balances.filter(balance => balance.Currency === config.get('sienaAccount.baseCurrency'))[0].Balance;
  } catch (e) {
    log.error(`${config.get('sienaAccount.baseCurrency')} not found in your account`);
    log.info(`You need to transfer some ${config.get('sienaAccount.baseCurrency')} into your account`);
    process.exit();
  }
  log.info(`${config.get('sienaAccount.baseCurrency')} found with balance ${baseCurrencyWalletBalance}`);

  let securityCurrencyWalletBalance;
  try {
    securityCurrencyWalletBalance = balances.filter(balance => balance.Currency === config.get('sienaAccount.securityCurrency'))[0].Balance;
  } catch (e) {
    // Your bittrex account does not have a wallet with your security currency
    // Buy some target currency so that a wallet gets created
    const ticker = await getTicker(config.get('bittrexMarket'));
    const buyQuantity = sienaAccount.getTradeAmount() / ticker.Ask;
    const commission = tradeStub.getCommission(buyQuantity, ticker.Ask);
    const buyLesserQuantity = 0.1 * ((sienaAccount.getTradeAmount() - commission) / ticker.Ask);

    log.info(`buySecurity: Buy ${buyLesserQuantity}${config.get('sienaAccount.securityCurrency')} for ${ticker.Ask} on ${new Date()}`);
    const order = await buyLimit(config.get('bittrexMarket'), buyLesserQuantity, ticker.Ask);
    log.info(`buySecurity, buyOrderUuid: ${order.uuid}`);
  } finally {
    log.info(`${config.get('sienaAccount.securityCurrency')} found with balance ${securityCurrencyWalletBalance}`);
    log.info('Setup complete');
  }
})();
