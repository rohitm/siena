# Siena
Autotrade cryptocurrencies on bittrex based on simple moving average formula

## Autotrade strategy
I've put together a rules engine to chew on these rules based on the simple moving average formula

```
RULE fail safe
  IF (account balance IS LESSER THAN some arbitrary lower limit)
  THEN sell all held security positions and halt further trading

RULE buy security
  IF (security's simple moving average has breached the crossover point  
  AND momentum is trending UP
  AND the time since last transaction is greater than the short term period)
  THEN buy security FOR amount available to trade

RULE sell security
  IF (security's simple moving average has breached the crossover point  
  AND momentum is trending DOWN)
  THEN sell all held positions of security

RULE compute momentum
  IF (security's long term moving average IS GREATER THAN security's short term moving average)
  THEN momentum is trending DOWN

RULE compute momentum
  IF (security's long term moving average IS LESSER THAN security's short term moving average)
  THEN momentum is trending UP

RULE detect crossover
  IF (security's momentum went from (UP to DOWN) OR (DOWN TO UP)
  THEN crossover point has breached

RULE fetch account balance
  IF (any security is sold OR bought)
  THEN get account balance.

RULE fetch account balance
  IF any funds (deposited OR withdrawn) from account
  THEN get account balance.

RULE compartmentalise your account for trade
  IF account balance = x
  THEN compartmentalise account amount for trading and a reserve balance
```
