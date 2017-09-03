const helper = require('../helper');

class Account {
  constructor(balance = 0) {
    this.setBalance(balance);
  }

  setBalance(balance) {
    const compartmentalisedBalance = helper.compartmentalise(balance);
    this.tradeAmount = compartmentalisedBalance.tradeAmount;
    this.reserve = compartmentalisedBalance.reserve;
  }

  getBalance() {
    return helper.compartmentalise(this.getBalanceNumber());
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
