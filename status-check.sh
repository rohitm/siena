echo "Net Asset Value:"
npm run get-nav | ./node_modules/.bin/bunyan
echo "Running Services:"
npm run forever-list
echo "Logs:"
tail siena.log | ./node_modules/.bin/bunyan
tail market-history-cache.log | ./node_modules/.bin/bunyan
echo "Current UTC:"
date -u
echo "Last few crossovers:"
cat siena.log | ./node_modules/.bin/bunyan | grep "crossover" | tail
echo "Last Transaction:"
grep "for" siena.log | tail -1
echo "Lower Sell Trigger Price:"
grep "Lower SELL trigger" siena.log | tail -1
echo "Upper Sell Trigger Price:"
grep "Upper SELL trigger" siena.log | tail -1
