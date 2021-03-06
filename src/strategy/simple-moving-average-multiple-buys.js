const config = require('config');
const _ = require('lodash');

module.exports = [{
  condition: function condition(R) {
    R.when(_.has(this, 'principle') &&
     _.has(this, 'currentAccountValue') &&
     this.currentAccountValue < (this.principle - (config.get('sienaAccount.criticalPoint') * this.principle)));
  },
  consequence: function consequence(R) {
    // Market has crashed and your capital has eroded, Bail out!
    this.actions = ['halt'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'bittrexAccountBalances'));
  },
  consequence: function consequence(R) {
    this.actions = ['compartmentaliseAccount'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'movingAverageShort') &&
      _.has(this, 'movingAverageMid') &&
      _.has(this, 'movingAverageLong'));
  },
  consequence: function consequence(R) {
    this.actions = ['getMarketTrend', 'getAccountValue'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'event') &&
      _.has(this, 'market') &&
      _.has(this, 'lastTrade') &&
      _.has(this, 'currentBidPrice') &&
      this.event === 'crossover' &&
      this.market === 'volatile mid' &&
      this.lastTrade !== 'buy');
  },
  consequence: function consequence(R) {
    // Buy security slightly cheap around a bull market
    this.actions = ['buySecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'event') &&
      _.has(this, 'lastTrade') &&
      _.has(this, 'market') &&
      _.has(this, 'lastAverageBuyPrice') &&
      _.has(this, 'currentBidPrice') &&
      _.has(this, 'upperSellPercentage') &&
      this.event === 'crossover' &&
      this.currentBidPrice > (this.lastAverageBuyPrice +
        (this.upperSellPercentage * this.lastAverageBuyPrice)) &&
      this.lastTrade === 'buy' &&
      this.market !== 'bull');
  },
  consequence: function consequence(R) {
    // You've got a profit so cash in!
    this.actions = ['sellSecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'lastTrade') &&
      _.has(this, 'market') &&
      _.has(this, 'lastBuyPrice') &&
      _.has(this, 'currentBidPrice') &&
      this.currentBidPrice < (this.lastBuyPrice - (config.get('strategy.lowerBuyPercentage') * this.lastBuyPrice)) &&
      this.lastTrade === 'buy' &&
      this.market === 'bull');
  },
  consequence: function consequence(R) {
    // Buy a little more at a lower price
    this.actions = ['buySecurity'];
    R.stop();
  },
}, {
  condition: function condition(R) {
    R.when(_.has(this, 'lastTrade') &&
      _.has(this, 'market') &&
      _.has(this, 'lastAverageBuyPrice') &&
      _.has(this, 'currentBidPrice') &&
      _.has(this, 'accountBalance') &&
      this.currentBidPrice < (this.lastBuyPrice - (config.get('strategy.lowerSellPercentage') * this.lastAverageBuyPrice)) &&
      this.accountBalance <= config.get('sienaAccount.minTradeSize') &&
      this.lastTrade === 'buy' &&
      this.market === 'bear');
  },
  consequence: function consequence(R) {
    // You have no more money to buy and this is a bear market,
    // sell and wait for better buying opportunity.
    this.actions = ['sellSecurity'];
    R.stop();
  },
}];
