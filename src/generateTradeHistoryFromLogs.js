const filesystem = require("fs");
const _ = require('lodash');
const exec = require('child_process').exec;

const buySellPoints = {};
// Get all the log files from the current path
const readTasks = filesystem.readdirSync('./').filter(file => _.endsWith(file, '.log')).map((file) => new Promise((resolve, reject) => {
  exec(`cat ${file} | grep "tradeHistory"`, (error, stdout, stderr) => {
    if(error || stderr || stdout.trim().length === 0) {
      return resolve(true);
    }

    stdout.split('\n').filter((log) => {
      let obj
      try {
        obj = JSON.parse(log);
      } catch (e) {
        return false;
      }

      return log;
    }).forEach((log) => {
      const obj = JSON.parse(log);
      buySellPoints[obj.timestamp] = `${obj.timestamp},${obj.price},${obj.buyOrSell}`

    });
    resolve (true);
  });
}));

Promise.all(readTasks).then(() => {
  const buySellPointsString = Object.keys(buySellPoints).sort().map(timestamp => buySellPoints[timestamp]).join('\n');
});
