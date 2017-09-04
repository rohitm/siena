const config = require('config');
const _ = require('lodash');

const compartmentalise = (amount) => {
  // Splits the money you have to trade and the rest into reserve

  // Amount available to trade = 80% of the amount or 1000
  let tradeAmount;
  const tradeAmountUpperLimit = config.get('sienaAccount.tradeAmountUpperLimit');
  if (amount >= tradeAmountUpperLimit) {
    tradeAmount = tradeAmountUpperLimit;
  } else {
    tradeAmount = config.get('sienaAccount.tradeAmountPercentage') * amount;
  }

  const reserve = amount - tradeAmount;
  return ({ tradeAmount, reserve, total: tradeAmount + reserve });
};

class Account {
  constructor(baseCurrency = config.get('sienaAccount.baseCurrency'), balance = 0) {
    this.baseCurrency = baseCurrency;
    this.setBalance(balance);
  }

  setBalance(balance) {
    const compartmentalisedBalance = compartmentalise(balance);
    this.tradeAmount = compartmentalisedBalance.tradeAmount;
    this.reserve = compartmentalisedBalance.reserve;
  }

  setBittrexBalance(bittrexBalances) {
    const account = _.filter(bittrexBalances,
      bittrexAccount => (bittrexAccount.Currency === this.baseCurrency));

    if (account.length === 0) {
      return new Error(`${config.get('sienaAccount.baseCurrency')} balance not found on bittrex`);
    }

    this.setBalance(account[0].Balance);
    return (this.getBalance());
  }

  getBalance() {
    return compartmentalise(this.getBalanceNumber());
  }

  getBalanceNumber() {
    return this.tradeAmount + this.reserve;
  }

  getTradeAmount() {
    return this.tradeAmount;
  }

  getReserve() {
    return this.reserve;
  }

  credit(amount = null) {
    if (amount === null) {
      return (this.getBalance());
    }

    this.setBalance(this.getBalanceNumber() + amount);
    return (this.getBalance());
  }

  debit(amount) {
    if (amount === null) {
      return (this.getBalance());
    }

    if (amount > this.getBalanceNumber()) {
      this.setBalance(0);
    } else {
      this.setBalance(this.getBalanceNumber() - amount);
    }

    return (this.getBalance());
  }
}

module.exports = Account;
