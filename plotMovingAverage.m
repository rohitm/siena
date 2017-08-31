seconds = tradeHistory(1, 1):1000:tradeHistory(end, 1);
movingAverages1 = [];
movingAverages2 = [];

for endTime = seconds
  % Short moving average
  startTime = endTime - 1125000;
  movingAverages1(end+1) = mean(tradeHistory(find (tradeHistory(:,1) >= startTime & tradeHistory(:,1) <= endTime), 2));

  % Long moving average
  startTime = endTime - 18000000;
  movingAverages2(end+1) = mean(tradeHistory(find (tradeHistory(:,1) >= startTime & tradeHistory(:,1) <= endTime), 2));
end

plot(seconds, movingAverages1, '-r.')
hold on
  plot(seconds, movingAverages2, '-b.')
hold off
