const config = require('config');
const _ = require('lodash');
const getTicker = require('./get-ticker');

const compartmentalise = (amount, currentTradeAmount = 0) => {
  if (amount <= 0) {
    return ({ tradeAmount: 0, reserve: 0, total: 0 });
  }

  let tradeAmount;
  if (currentTradeAmount === 0) {
    tradeAmount = config.get('sienaAccount.tradeAmountPercentage') * amount;
  } else if (currentTradeAmount < amount) {
    tradeAmount = currentTradeAmount;
  } else if (currentTradeAmount >= amount) {
    tradeAmount = amount;
  }

  const reserve = amount - tradeAmount;
  return ({ tradeAmount, reserve, total: tradeAmount + reserve });
};

class Account {
  constructor(baseCurrency = config.get('sienaAccount.baseCurrency'), balance = 0) {
    this.baseCurrency = baseCurrency;
    this.tradeLog = [];
    this.tradeAmount = 0;
    this.setBalance(balance);
  }

  setBalance(balance) {
    const compartmentalisedBalance = compartmentalise(balance, this.tradeAmount);
    this.tradeAmount = compartmentalisedBalance.tradeAmount;
    this.reserve = compartmentalisedBalance.reserve;
  }

  setBittrexBalance(bittrexBalances) {
    this.bittrexBalances = bittrexBalances;
    const account = _.filter(bittrexBalances,
      bittrexAccount => (bittrexAccount.Currency === this.baseCurrency));

    if (account.length === 0) {
      return new Error(`${config.get('sienaAccount.baseCurrency')} balance not found on bittrex`);
    }

    this.setBalance(account[0].Available);
    return (this.getBittrexBalance(this.baseCurrency));
  }

  getBittrexBalance(securityCurrency = config.get('sienaAccount.securityCurrency')) {
    const account = _.filter(this.bittrexBalances,
      bittrexAccount => (bittrexAccount.Currency === securityCurrency));

    if (account.length === 0) {
      return new Error(`${securityCurrency} balance not found on bittrex`);
    }

    return (account[0].Available);
  }

  getBalance() {
    return compartmentalise(this.getBalanceNumber(), this.tradeAmount);
  }

  getBittrexBalanceObj() {
    return this.bittrexBalances;
  }

  async calibrateTradeAmount() {
    const accountValue = await this.getAccountValue();
    const balance = this.getBalanceNumber();
    const compartmentalisedBalance = compartmentalise(accountValue, balance);
    this.tradeAmount = compartmentalisedBalance.tradeAmount;
    this.reserve = compartmentalisedBalance.reserve;
    return compartmentalisedBalance;
  }

  getBalanceNumber() {
    return this.tradeAmount + this.reserve;
  }

  async getAccountValue(bittrexBalances, market = config.get('bittrexMarket')) {
    if (bittrexBalances !== undefined) {
      this.setBittrexBalance(bittrexBalances);
    }

    const ticker = await getTicker(market);
    const midPrice = (ticker.Bid + ticker.Ask) / 2;
    return this.getBalanceNumber() + (this.getBittrexBalance() * midPrice);
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

    // Reset the current tradeAmount
    const currentBalanceNumber = this.getBalanceNumber();
    this.tradeAmount = 0;
    this.setBalance(currentBalanceNumber + amount);
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

  trade(action, price, amount) {
    if (price === null) {
      return false;
    }
    if (action.toLowerCase() !== 'sell' && action.toLowerCase() !== 'buy') {
      return false;
    }
    if (amount !== undefined) {
      if (action.toLowerCase() === 'buy') {
        this.debit(amount);
      } else {
        this.credit(amount);
      }
    }
    this.tradeLog.push({ action: action.toLowerCase(), price, time: new Date().getTime() });
    return (true);
  }

  getLastAverageBuyPrice() {
    if (this.tradeLog.length === 0) {
      return false;
    }

    const buyIndex = _.findLastIndex(this.tradeLog, { action: 'buy' });
    if (buyIndex === -1) {
      return false;
    }

    const spliced = _.cloneDeep(this.tradeLog).splice(0, buyIndex + 1);
    let sellIndex = _.findLastIndex(spliced, { action: 'sell' });
    if (sellIndex === -1) {
      sellIndex = 0;
    } else {
      sellIndex += 1;
    }

    const buyTrades = spliced.splice(sellIndex, spliced.length);
    const count = buyTrades.length;
    const sum = buyTrades
      .map(trade => trade.price)
      .reduce((accumulator, currentValue) => accumulator + currentValue);
    return (sum / count);
  }
  getLastTrade() {
    if (this.tradeLog.length === 0) {
      return false;
    }

    return _.cloneDeep(this.tradeLog).pop();
  }
  getLastSellPrice() {
    return (this.getLastPriceByAction('sell'));
  }
  getLastBuyPrice() {
    return (this.getLastPriceByAction('buy'));
  }
  getLastPriceByAction(action) {
    if (action.toLowerCase() !== 'sell' && action.toLowerCase() !== 'buy') {
      return false;
    }
    if (this.tradeLog.length === 0) {
      return false;
    }

    const buyIndex = _.findLastIndex(this.tradeLog, { action });
    if (buyIndex === -1) {
      return false;
    }

    return (this.tradeLog[buyIndex].price);
  }
}

module.exports = Account;
