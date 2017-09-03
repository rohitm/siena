const config = require('config');
const logger = require('cli-logger');

const log = logger({ level: logger.INFO });

const getCommission = (quantity, price) => quantity * price * config.get('bittrexCommission');

const buy = (quantity, price) => {
  const subTotal = quantity * price;
  const commission = getCommission(quantity, price);
  const total = subTotal + commission;
  const security = quantity;
  log.info(`Security Quantity: ${quantity}`);
  log.info(`Buy price: ${price}`);
  log.info(`Sub Total: ${subTotal}`);
  log.info(`Commission: ${commission}`);
  log.info(`Total: ${total}`);
  log.info(`Total security: ${security}`);

  return ({ total, commission, security });
};

const sell = (quantity, price) => {
  const subTotal = quantity * price;
  const commission = getCommission(quantity, price);
  const total = subTotal - commission;
  log.info(`Security Quantity: ${quantity}`);
  log.info(`Sell price: ${price}`);
  log.info(`Sub Total: ${subTotal}`);
  log.info(`Commission: ${commission}`);
  log.info(`Total: ${total}`);

  return ({ total, commission });
};

module.exports = { buy, sell, getCommission };
