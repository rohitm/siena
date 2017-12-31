crossoverData=load("crossoverData.txt");
% crossoverData = [smoothdata(crossoverData(:,1)), smoothdata(crossoverData(:,2))];
buySellPoints=load("strategyResultData.txt");
figure('Color',[0.8 0.8 0.8]);
plot(crossoverData(:,1),crossoverData(:,2),'-k');

hold on
  buySellTimestamps = buySellPoints(:,1);
  buySellPrices = buySellPoints(:, 2);
  buyOrSell = buySellPoints(:,3);

  % Plot sell points
  scatter(buySellTimestamps(buyOrSell == 1), buySellPrices(buyOrSell == 1), 5, 'b', 's');

  % Plot buy points
  scatter(buySellTimestamps(buyOrSell == 0), buySellPrices(buyOrSell == 0), 5, 'r', 'o');
hold off

startTime=datestr(crossoverData(1, 1)/86400/1000 + datenum(1970,1,1));
endTime=datestr(crossoverData(end, 1)/86400/1000 + datenum(1970,1,1));
middleTime=datestr(crossoverData(ceil(end/2), 1)/86400/1000 + datenum(1970,1,1));
text(crossoverData(ceil(end/2), 1), crossoverData(ceil(end/2), 2),middleTime,'Color','red');
text(crossoverData(1, 1), crossoverData(ceil(end/2), 2), startTime,'Color','red');
text(crossoverData(end, 1), crossoverData(ceil(end/2), 2), endTime,'Color','red');
% movingAverageRef = refline([0 mean(tradeHistory(:,2))])
% movingAverageRef.Color = 'g'
% text(tradeHistory(1, 1), mean(tradeHistory(:,2)), num2str(mean(tradeHistory(:,2))),'Color','green')
