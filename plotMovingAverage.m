tradeHistory=load("tradeHistory.txt");
buySellPoints=load("strategyResultData.txt");

seconds = tradeHistory(1, 1):1000:tradeHistory(end, 1);
movingAverages1 = [];
movingAverages2 = [];

buySellTimestamps = buySellPoints(:,1);
buySellPrices = buySellPoints(:, 2);
buyOrSell = buySellPoints(:,3);

for endTime = seconds
  % Short moving average
  startTime = endTime - 3600000;
  movingAverages1(end+1) = mean(tradeHistory(find (tradeHistory(:,1) >= startTime & tradeHistory(:,1) <= endTime), 2));

  % Long moving average
  startTime = endTime - 21600000;
  movingAverages2(end+1) = mean(tradeHistory(find (tradeHistory(:,1) >= startTime & tradeHistory(:,1) <= endTime), 2));
end

plot(seconds, movingAverages1, '-r.');
hold on
  plot(seconds, movingAverages2, '-b.');
  plot(tradeHistory(:,1),tradeHistory(:,2),'-k.');

  % Plot sell points
  scatter(buySellTimestamps(buyOrSell == 1), buySellPrices(buyOrSell == 1), 100, 'b', '*');

  % Plot buy points
  scatter(buySellTimestamps(buyOrSell == 0), buySellPrices(buyOrSell == 0), 100, 'r', '*');
hold off
