## Methods
| **Symbol** | **Meaning**                                                                              |
| :--------: | :--------------------------------------------------------------------------------------- |
|    **◯**   | Execution gas for this method does not include intrinsic gas overhead                    |
|    **△**   | Cost was non-zero but below the precision setting for the currency display (see options) |

|                                                    |     Min |        Max |     Avg | Calls | usd avg |
| :------------------------------------------------- | ------: | ---------: | ------: | ----: | ------: |
| **BTCPriceOracleMock**                             |         |            |         |       |         |
|        *setPrice*                                  |       - |          - |  31,786 |     2 |       - |
| **Futures**                                        |         |            |         |       |         |
|        *addMargin*                                 |  59,240 |    110,552 |  73,223 |   123 |       - |
|        *approve*                                   |       - |          - |  51,687 |     3 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   7,716 |   108 |       - |
|     **◯**  *breachPenaltyRatePerDay*               |       - |          - |   7,251 |     1 |       - |
|        *closeDelivery*                             | 151,564 |    164,960 | 155,441 |    11 |       - |
|     **◯**  *collectedFeesBalance*                  |       - |          - |   7,320 |    10 |       - |
|        *createOrder*                               |  98,579 | 12,270,394 | 899,241 |   321 |       - |
|     **◯**  *decimals*                              |       - |          - |   7,271 |     1 |       - |
|     **◯**  *deliveryDurationDays*                  |       - |          - |   7,288 |     4 |       - |
|     **◯**  *deliveryIntervalDays*                  |       - |          - |   7,289 |     6 |       - |
|        *depositDeliveryPayment*                    | 124,778 |    198,599 | 161,689 |     2 |       - |
|        *depositDeliveryPayment*                    |  74,187 |    107,713 |  82,415 |     9 |       - |
|        *depositReservePool*                        |  64,378 |    132,778 |  98,578 |     2 |       - |
|     **◯**  *firstFutureDeliveryDate*               |       - |          - |   7,275 |     6 |       - |
|     **◯**  *futureDeliveryDatesCount*              |       - |          - |   7,309 |     1 |       - |
|     **◯**  *getCollateralDeficit*                  |  12,621 |     63,786 |  38,204 |     2 |       - |
|     **◯**  *getDeliveryDates*                      |  12,098 |     21,477 |  19,209 |    11 |       - |
|     **◯**  *getMarketPrice*                        |       - |          - |  35,403 |    57 |       - |
|     **◯**  *getMinMargin*                          |  10,136 |    110,687 |  72,119 |    32 |       - |
|     **◯**  *getMinMarginForPosition*               |  42,530 |     42,613 |  42,572 |     6 |       - |
|     **◯**  *getOrderById*                          |       - |          - |  17,348 |    10 |       - |
|     **◯**  *getPositionById*                       |  24,037 |     24,288 |  24,252 |    14 |       - |
|     **◯**  *getPositionsByParticipantDeliveryDate* |   8,185 |     10,631 |   9,000 |     3 |       - |
|     **◯**  *hashrateOracle*                        |       - |          - |   7,360 |     1 |       - |
|     **◯**  *liquidationMarginPercent*              |       - |          - |   7,354 |     1 |       - |
|        *marginCall*                                |  90,682 |    721,297 | 361,664 |    17 |       - |
|     **◯**  *MAX_ORDERS_PER_PARTICIPANT*            |       - |          - |   5,184 |     1 |       - |
|        *multicall*                                 | 188,920 |    710,547 | 449,734 |     4 |       - |
|     **◯**  *name*                                  |       - |          - |   8,363 |     1 |       - |
|     **◯**  *orderFee*                              |       - |          - |   7,299 |     6 |       - |
|        *removeMargin*                              |  61,832 |    141,491 |  95,967 |     4 |       - |
|     **◯**  *reservePoolBalance*                    |       - |          - |   7,252 |     4 |       - |
|        *setFeeDiscountPercent*                     |  31,515 |     51,427 |  44,790 |     3 |       - |
|        *setFutureDeliveryDatesCount*               |       - |          - |  33,785 |     5 |       - |
|        *setOrderFee*                               |  29,892 |     51,828 |  40,860 |     2 |       - |
|        *setValidatorURL*                           |       - |          - |  99,221 |     1 |       - |
|     **◯**  *speedHps*                              |       - |          - |   7,319 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   8,382 |     1 |       - |
|     **◯**  *token*                                 |       - |          - |   7,315 |     1 |       - |
|     **◯**  *validatorAddress*                      |       - |          - |   7,317 |     1 |       - |
|        *withdrawCollectedFees*                     |       - |          - |  58,173 |     1 |       - |
|        *withdrawDeliveryPayment*                   |  52,396 |     59,343 |  53,785 |     5 |       - |
|        *withdrawReservePool*                       |  51,390 |     64,237 |  57,814 |     2 |       - |
| **HashrateOracle**                                 |         |            |         |       |         |
|     **◯**  *getHashesForBTC*                       |       - |          - |  11,936 |    10 |       - |
|        *setHashesForBTC*                           |  38,569 |     72,781 |  41,687 |    11 |       - |
|        *setTTL*                                    |       - |          - |  73,726 |     1 |       - |
|        *setUpdaterAddress*                         |       - |          - |  51,017 |     1 |       - |
| **USDCMock**                                       |         |            |         |       |         |
|        *approve*                                   |       - |          - |  46,683 |     5 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   2,562 |     6 |       - |
|     **◯**  *decimals*                              |       - |          - |     177 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   3,216 |     1 |       - |
|        *transfer*                                  |  51,584 |     51,596 |  51,594 |     5 |       - |

## Deployments
|                        |     Min |    Max  |       Avg | Block % | usd avg |
| :--------------------- | ------: | ------: | --------: | ------: | ------: |
| **BTCPriceOracleMock** |       - |       - |   296,627 |     1 % |       - |
| **ERC1967Proxy**       | 180,114 | 376,802 |   278,458 |   0.9 % |       - |
| **Futures**            |       - |       - | 5,301,793 |  17.7 % |       - |
| **HashrateOracle**     |       - |       - | 1,145,530 |   3.8 % |       - |
| **Multicall3**         |       - |       - |   763,329 |   2.5 % |       - |
| **USDCMock**           |       - |       - |   557,667 |   1.9 % |       - |

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

