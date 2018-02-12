# Siena
A trading bot that uses IFTTT like rules described in [strategy files](https://github.com/rohitm/siena/tree/master/src/strategy) to trade on bittrex. Extend this framework with your own strategies based on other technical indicators.

## Autotrade rules - Simple moving average.

```
RULE compute market with moving averages
  IF short moving average IS GREATER THAN mid moving average
  AND mid moving average IS GREATER THAN long moving average
  THEN market = BULL

  IF long moving average IS GREATER THAN mid moving average
  AND mid moving average IS GREATER THAN short moving average
  THEN market = BEAR

  ELSE market = VOLATILE

RULE fail safe
  IF (current account value IS LESSER THAN yesterday's value BY some arbitrary percentage)
  THEN sell all held security positions 
    AND halt further trading

RULE buy security
  IF (market condition IS BULL)
  THEN buy security FOR amount available to trade

RULE buy security cheaper
  IF (market condition IS BULL AND
  current bid price IS LESSER THAN last buy price BY certain percentage)
  THEN buy more security FOR amount available to trade

RULE sell security
  IF (moving averages have crossed over  
  AND market condition IS NOT BULL
  AND current bid price IS GREATER THAN last buy price BY certain percentage)
  THEN sell all held positions of security

RULE compartmentalise your account for trade
  IF account balance = x
  THEN compartmentalise account amount for trading and a reserve balance
```

## Installation 
The project requires 
- A bittrex account with API keys
- A machine with node/redis/matlab setup
- A configuration that is tweaked to the currency market that you wish to trade with.
I'd be willing to jot down the documentation for all this if there is sufficient traction from the community. Feel free [create an issue](https://github.com/rohitm/siena/issues), I will honour popular demand.

### Disclaimer
All code provided on this repository is for experimental and demostration purposes only. I take no responsibility for any monetary loss from its use. Please use this project at your own risk.
