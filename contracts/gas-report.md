## Methods
| **Symbol** | **Meaning**                                                                              |
| :--------: | :--------------------------------------------------------------------------------------- |
|    **◯**   | Execution gas for this method does not include intrinsic gas overhead                    |
|    **△**   | Cost was non-zero but below the precision setting for the currency display (see options) |

|                                                    |     Min |        Max |     Avg | Calls | usd avg |
| :------------------------------------------------- | ------: | ---------: | ------: | ----: | ------: |
| **BTCPriceOracleMock**                             |         |            |         |       |         |
|        *setPrice*                                  |       - |          - |  31,782 |     2 |       - |
| **Futures**                                        |         |            |         |       |         |
|        *addMargin*                                 |  59,207 |    110,519 |  73,190 |   123 |       - |
|        *approve*                                   |       - |          - |  51,669 |     3 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   7,700 |   108 |       - |
|     **◯**  *breachPenaltyRatePerDay*               |       - |          - |   7,241 |     1 |       - |
|        *closeDelivery*                             | 151,449 |    164,823 | 155,322 |    11 |       - |
|     **◯**  *collectedFeesBalance*                  |       - |          - |   7,310 |    10 |       - |
|        *createOrder*                               |  98,465 | 12,262,519 | 897,773 |   321 |       - |
|     **◯**  *decimals*                              |       - |          - |   7,261 |     1 |       - |
|     **◯**  *deliveryDurationDays*                  |       - |          - |   7,278 |     4 |       - |
|     **◯**  *deliveryIntervalDays*                  |       - |          - |   7,279 |     6 |       - |
|        *depositDeliveryPayment*                    | 124,678 |    198,287 | 161,483 |     2 |       - |
|        *depositDeliveryPayment*                    |  74,155 |    107,664 |  82,379 |     9 |       - |
|        *depositReservePool*                        |  64,344 |    132,744 |  98,544 |     2 |       - |
|     **◯**  *firstFutureDeliveryDate*               |       - |          - |   7,265 |     6 |       - |
|     **◯**  *futureDeliveryDatesCount*              |       - |          - |   7,299 |     1 |       - |
|     **◯**  *getCollateralDeficit*                  |  12,597 |     63,698 |  38,148 |     2 |       - |
|     **◯**  *getDeliveryDates*                      |  12,079 |     21,449 |  19,183 |    11 |       - |
|     **◯**  *getMarketPrice*                        |       - |          - |  35,798 |    57 |       - |
|     **◯**  *getMinMargin*                          |  10,121 |    110,481 |  72,023 |    32 |       - |
|     **◯**  *getMinMarginForPosition*               |  42,467 |     42,548 |  42,508 |     6 |       - |
|     **◯**  *getOrderById*                          |       - |          - |  17,286 |    10 |       - |
|     **◯**  *getPositionById*                       |  23,973 |     24,159 |  24,132 |    14 |       - |
|     **◯**  *getPositionsByParticipantDeliveryDate* |   8,169 |     10,613 |   8,984 |     3 |       - |
|     **◯**  *hashrateOracle*                        |       - |          - |   7,460 |     1 |       - |
|     **◯**  *liquidationMarginPercent*              |       - |          - |   7,454 |     1 |       - |
|        *marginCall*                                |  90,598 |    720,578 | 361,337 |    17 |       - |
|     **◯**  *MAX_ORDERS_PER_PARTICIPANT*            |       - |          - |   5,174 |     1 |       - |
|        *multicall*                                 | 187,885 |    709,066 | 448,476 |     4 |       - |
|     **◯**  *name*                                  |       - |          - |   8,240 |     1 |       - |
|     **◯**  *orderFee*                              |       - |          - |   7,289 |     6 |       - |
|        *removeMargin*                              |  61,791 |    141,320 |  95,878 |     4 |       - |
|     **◯**  *reservePoolBalance*                    |       - |          - |   7,242 |     4 |       - |
|        *setFeeDiscountPercent*                     |  31,502 |     51,414 |  44,777 |     3 |       - |
|        *setFutureDeliveryDatesCount*               |       - |          - |  33,774 |     5 |       - |
|        *setOrderFee*                               |  29,881 |     51,817 |  40,849 |     2 |       - |
|        *setValidatorURL*                           |       - |          - |  99,031 |     1 |       - |
|     **◯**  *speedHps*                              |       - |          - |   7,309 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   8,259 |     1 |       - |
|     **◯**  *token*                                 |       - |          - |   7,305 |     1 |       - |
|     **◯**  *validatorAddress*                      |       - |          - |   7,307 |     1 |       - |
|        *withdrawCollectedFees*                     |       - |          - |  58,155 |     1 |       - |
|        *withdrawDeliveryPayment*                   |  52,365 |     59,304 |  53,753 |     5 |       - |
|        *withdrawReservePool*                       |  51,365 |     64,206 |  57,786 |     2 |       - |
| **HashrateOracle**                                 |         |            |         |       |         |
|     **◯**  *getHashesForBTC*                       |       - |          - |  11,922 |    10 |       - |
|        *setHashesForBTC*                           |  38,555 |     72,767 |  41,673 |    11 |       - |
|        *setTTL*                                    |       - |          - |  73,714 |     1 |       - |
|        *setUpdaterAddress*                         |       - |          - |  51,006 |     1 |       - |
| **USDCMock**                                       |         |            |         |       |         |
|        *approve*                                   |       - |          - |  46,678 |     5 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   2,559 |     6 |       - |
|     **◯**  *decimals*                              |       - |          - |     176 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   3,129 |     1 |       - |
|        *transfer*                                  |  51,577 |     51,589 |  51,587 |     5 |       - |

## Deployments
|                        |     Min |    Max  |       Avg | Block % | usd avg |
| :--------------------- | ------: | ------: | --------: | ------: | ------: |
| **BTCPriceOracleMock** |       - |       - |   287,680 |     1 % |       - |
| **ERC1967Proxy**       | 177,746 | 372,569 |   275,158 |   0.9 % |       - |
| **Futures**            |       - |       - | 5,172,179 |  17.2 % |       - |
| **HashrateOracle**     |       - |       - | 1,116,832 |   3.7 % |       - |
| **Multicall3**         |       - |       - |   740,586 |   2.5 % |       - |
| **USDCMock**           |       - |       - |   544,630 |   1.8 % |       - |

## Solidity and Network Config
| **Settings**        | **Value**  |
| ------------------- | ---------- |
| Solidity: version   | 0.8.30     |
| Solidity: optimized | true       |
| Solidity: runs      | 200        |
| Solidity: viaIR     | false      |
| Block Limit         | 30,000,000 |
| Gas Price           | -          |
| Token Price         | -          |
| Network             | ETHEREUM   |
| Toolchain           | hardhat    |

