roughTradeHistory=load("tradeHistory.txt");
tradeHistory = [smoothdata(roughTradeHistory(:,1)), smoothdata(roughTradeHistory(:,2))];
buySellPoints=load("strategyResultData.txt");
figure('Color',[0.8 0.8 0.8]);
plot(tradeHistory(:,1),tradeHistory(:,2),'-k.');

hold on
  buySellTimestamps = buySellPoints(:,1);
  buySellPrices = buySellPoints(:, 2);
  buyOrSell = buySellPoints(:,3);

  % Plot sell points
  scatter(buySellTimestamps(buyOrSell == 1), buySellPrices(buyOrSell == 1), 50, 'r', 's');

  % Plot buy points

  scatter(buySellTimestamps(buyOrSell == 0), buySellPrices(buyOrSell == 0), 50, 'r', 'o');
hold off

startTime=datestr(tradeHistory(1, 1)/86400/1000 + datenum(1970,1,1));
endTime=datestr(tradeHistory(end, 1)/86400/1000 + datenum(1970,1,1));
middleTime=datestr(tradeHistory(ceil(end/2), 1)/86400/1000 + datenum(1970,1,1));
text(tradeHistory(ceil(end/2), 1), tradeHistory(ceil(end/2), 2),middleTime,'Color','red');
text(tradeHistory(1, 1), tradeHistory(ceil(end/2), 2), startTime,'Color','red');
text(tradeHistory(end, 1), tradeHistory(ceil(end/2), 2), endTime,'Color','red');
% movingAverageRef = refline([0 mean(tradeHistory(:,2))])
% movingAverageRef.Color = 'g'
% text(tradeHistory(1, 1), mean(tradeHistory(:,2)), num2str(mean(tradeHistory(:,2))),'Color','green')
