const filesystem = require('fs');
const _ = require('lodash');
const exec = require('child_process').exec;
const fs = require('fs');
const bunyan = require('bunyan');

const log = bunyan.createLogger({ name: 'generateTradeHistoryFromLogs' });

const buySellPoints = {};
// Get all the log files from the current path
const readTasks = filesystem.readdirSync('./').filter(file => _.endsWith(file, '.log')).map(file => new Promise((resolve) => {
  exec(`cat ${file} | grep "tradeHistory"`, (error, stdout, stderr) => {
    if (error || stderr || stdout.trim().length === 0) {
      log.warn(`${file} isn't useful`);
      return resolve(true);
    }

    stdout.split('\n').filter((logMessage) => {
      if (logMessage.trim() === '') {
        return false;
      }

      try {
        JSON.parse(logMessage);
      } catch (e) {
        log.warn(`${logMessage} isn't useful`);
        return false;
      }

      return logMessage;
    }).forEach((logMessage) => {
      const obj = JSON.parse(logMessage);
      buySellPoints[obj.timestamp] = `${obj.timestamp},${obj.price},${obj.buyOrSell}`;
    });
    return resolve(true);
  });
}));

Promise.all(readTasks).then(() => {
  if (buySellPoints.length === 0) {
    return log.warn('Logs didn\'t contain trade entries');
  }

  log.info(`${Object.keys(buySellPoints).length} trades obtained.`);
  const buySellPointsString = Object.keys(buySellPoints).sort().map(timestamp => buySellPoints[timestamp]).join('\n');
  fs.writeFile('./tradeHistory.txt', buySellPointsString, (err) => {
    if (err) {
      return log.err(err);
    }

    return log.info('Generated tradeHistory.txt');
  });
  return true;
});
