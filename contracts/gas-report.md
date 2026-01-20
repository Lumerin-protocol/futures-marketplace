## Methods
| **Symbol** | **Meaning**                                                                              |
| :--------: | :--------------------------------------------------------------------------------------- |
|    **◯**   | Execution gas for this method does not include intrinsic gas overhead                    |
|    **△**   | Cost was non-zero but below the precision setting for the currency display (see options) |

|                                                    |     Min |        Max |     Avg | Calls | usd avg |
| :------------------------------------------------- | ------: | ---------: | ------: | ----: | ------: |
| **BTCPriceOracleMock**                             |         |            |         |       |         |
|        *setPrice*                                  |       - |          - |  31,677 |     2 |       - |
| **Futures**                                        |         |            |         |       |         |
|        *addMargin*                                 |  58,819 |    110,131 |  72,802 |   123 |       - |
|        *approve*                                   |       - |          - |  51,063 |     3 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   7,838 |   108 |       - |
|     **◯**  *breachPenaltyRatePerDay*               |       - |          - |   8,471 |     1 |       - |
|        *closeDelivery*                             | 149,049 |    161,770 | 152,756 |    11 |       - |
|     **◯**  *collectedFeesBalance*                  |       - |          - |   7,566 |    10 |       - |
|        *createOrder*                               |  96,828 | 12,144,830 | 857,955 |   321 |       - |
|     **◯**  *decimals*                              |       - |          - |   7,423 |     1 |       - |
|     **◯**  *deliveryDurationDays*                  |       - |          - |   7,600 |     4 |       - |
|     **◯**  *deliveryIntervalDays*                  |       - |          - |   7,512 |     6 |       - |
|        *depositDeliveryPayment*                    | 122,619 |    188,975 | 155,797 |     2 |       - |
|        *depositDeliveryPayment*                    |  74,538 |    107,547 |  82,639 |     9 |       - |
|        *depositReservePool*                        |  63,216 |    131,616 |  97,416 |     2 |       - |
|     **◯**  *firstFutureDeliveryDate*               |       - |          - |   7,698 |     6 |       - |
|     **◯**  *futureDeliveryDatesCount*              |       - |          - |   8,152 |     1 |       - |
|     **◯**  *getCollateralDeficit*                  |  12,362 |     61,460 |  36,911 |     2 |       - |
|     **◯**  *getDeliveryDates*                      |  12,474 |     18,971 |  17,390 |    11 |       - |
|     **◯**  *getMarketPrice*                        |       - |          - |  35,314 |    57 |       - |
|     **◯**  *getMinMargin*                          |   9,889 |    104,188 |  69,234 |    32 |       - |
|     **◯**  *getMinMarginForPosition*               |  41,657 |     41,728 |  41,693 |     6 |       - |
|     **◯**  *getOrderById*                          |       - |          - |  17,605 |    10 |       - |
|     **◯**  *getPositionById*                       |  24,672 |     24,687 |  24,685 |    14 |       - |
|     **◯**  *getPositionsByParticipantDeliveryDate* |   7,882 |     10,289 |   8,684 |     3 |       - |
|     **◯**  *hashrateOracle*                        |       - |          - |   8,467 |     1 |       - |
|     **◯**  *liquidationMarginPercent*              |       - |          - |   8,108 |     1 |       - |
|        *marginCall*                                |  88,691 |    707,762 | 354,987 |    17 |       - |
|     **◯**  *MAX_ORDERS_PER_PARTICIPANT*            |       - |          - |   5,748 |     1 |       - |
|        *multicall*                                 | 183,463 |    699,257 | 441,360 |     4 |       - |
|     **◯**  *name*                                  |       - |          - |   7,675 |     1 |       - |
|     **◯**  *orderFee*                              |       - |          - |   7,190 |     6 |       - |
|        *removeMargin*                              |  61,866 |    137,345 |  94,438 |     4 |       - |
|     **◯**  *reservePoolBalance*                    |       - |          - |   8,118 |     4 |       - |
|        *setFeeDiscountPercent*                     |  31,297 |     51,209 |  44,572 |     3 |       - |
|        *setFutureDeliveryDatesCount*               |       - |          - |  34,784 |     5 |       - |
|        *setOrderFee*                               |  30,435 |     52,371 |  41,403 |     2 |       - |
|        *setValidatorURL*                           |       - |          - |  98,581 |     1 |       - |
|     **◯**  *speedHps*                              |       - |          - |   7,478 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   8,316 |     1 |       - |
|     **◯**  *token*                                 |       - |          - |   8,512 |     1 |       - |
|     **◯**  *validatorAddress*                      |       - |          - |   7,451 |     1 |       - |
|        *withdrawCollectedFees*                     |       - |          - |  58,758 |     1 |       - |
|        *withdrawDeliveryPayment*                   |  51,581 |     58,416 |  52,948 |     5 |       - |
|        *withdrawReservePool*                       |  51,054 |     63,817 |  57,436 |     2 |       - |
| **HashrateOracle**                                 |         |            |         |       |         |
|     **◯**  *getHashesForBTC*                       |       - |          - |  11,831 |    10 |       - |
|        *setHashesForBTC*                           |  38,658 |     72,870 |  41,776 |    11 |       - |
|        *setTTL*                                    |       - |          - |  73,680 |     1 |       - |
|        *setUpdaterAddress*                         |       - |          - |  50,960 |     1 |       - |
| **USDCMock**                                       |         |            |         |       |         |
|        *approve*                                   |       - |          - |  46,269 |     5 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   2,515 |     6 |       - |
|     **◯**  *decimals*                              |       - |          - |     241 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   2,815 |     1 |       - |
|        *transfer*                                  |  51,204 |     51,216 |  51,214 |     5 |       - |

## Deployments
|                        |     Min |    Max  |       Avg | Block % | usd avg |
| :--------------------- | ------: | ------: | --------: | ------: | ------: |
| **BTCPriceOracleMock** |       - |       - |   282,195 |   0.9 % |       - |
| **ERC1967Proxy**       | 168,039 | 360,605 |   264,322 |   0.9 % |       - |
| **Futures**            |       - |       - | 4,436,471 |  14.8 % |       - |
| **HashrateOracle**     |       - |       - |   955,870 |   3.2 % |       - |
| **Multicall3**         |       - |       - |   631,146 |   2.1 % |       - |
| **USDCMock**           |       - |       - |   494,413 |   1.6 % |       - |

## Solidity and Network Config
| **Settings**        | **Value**  |
| ------------------- | ---------- |
| Solidity: version   | 0.8.30     |
| Solidity: optimized | true       |
| Solidity: runs      | 800        |
| Solidity: viaIR     | true       |
| Block Limit         | 30,000,000 |
| Gas Price           | -          |
| Token Price         | -          |
| Network             | ETHEREUM   |
| Toolchain           | hardhat    |

