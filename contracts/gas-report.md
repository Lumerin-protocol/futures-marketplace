## Methods
| **Symbol** | **Meaning**                                                                              |
| :--------: | :--------------------------------------------------------------------------------------- |
|    **◯**   | Execution gas for this method does not include intrinsic gas overhead                    |
|    **△**   | Cost was non-zero but below the precision setting for the currency display (see options) |

|                                                    |     Min |        Max |     Avg | Calls | usd avg |
| :------------------------------------------------- | ------: | ---------: | ------: | ----: | ------: |
| **BTCPriceOracleMock**                             |         |            |         |       |         |
|        *setPrice*                                  |       - |          - |  31,738 |     2 |       - |
| **Futures**                                        |         |            |         |       |         |
|        *addMargin*                                 |  59,183 |    110,495 |  73,166 |   123 |       - |
|        *approve*                                   |       - |          - |  51,657 |     3 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   7,676 |   108 |       - |
|     **◯**  *breachPenaltyRatePerDay*               |       - |          - |   7,229 |     1 |       - |
|        *closeDelivery*                             | 151,331 |    164,704 | 155,204 |    11 |       - |
|     **◯**  *collectedFeesBalance*                  |       - |          - |   7,298 |    10 |       - |
|        *createOrder*                               |  98,210 | 12,242,409 | 895,920 |   321 |       - |
|     **◯**  *decimals*                              |       - |          - |   7,249 |     1 |       - |
|     **◯**  *deliveryDurationDays*                  |       - |          - |   7,266 |     4 |       - |
|     **◯**  *deliveryIntervalDays*                  |       - |          - |   7,267 |     6 |       - |
|        *depositDeliveryPayment*                    | 124,540 |    197,903 | 161,222 |     2 |       - |
|        *depositDeliveryPayment*                    |  74,143 |    107,652 |  82,367 |     9 |       - |
|        *depositReservePool*                        |  64,320 |    132,720 |  98,520 |     2 |       - |
|     **◯**  *firstFutureDeliveryDate*               |       - |          - |   7,253 |     6 |       - |
|     **◯**  *futureDeliveryDatesCount*              |       - |          - |   7,287 |     1 |       - |
|     **◯**  *getCollateralDeficit*                  |  12,573 |     63,595 |  38,084 |     2 |       - |
|     **◯**  *getDeliveryDates*                      |  12,055 |     21,425 |  19,159 |    11 |       - |
|     **◯**  *getMarketPrice*                        |       - |          - |  35,707 |    57 |       - |
|     **◯**  *getMinMargin*                          |  10,109 |    110,231 |  71,912 |    32 |       - |
|     **◯**  *getMinMarginForPosition*               |  42,375 |     42,456 |  42,416 |     6 |       - |
|     **◯**  *getOrderById*                          |       - |          - |  17,274 |    10 |       - |
|     **◯**  *getPositionById*                       |  23,942 |     24,129 |  24,102 |    14 |       - |
|     **◯**  *getPositionsByParticipantDeliveryDate* |   8,157 |     10,601 |   8,972 |     3 |       - |
|     **◯**  *hashrateOracle*                        |       - |          - |   7,448 |     1 |       - |
|     **◯**  *liquidationMarginPercent*              |       - |          - |   7,442 |     1 |       - |
|        *marginCall*                                |  90,496 |    719,336 | 360,735 |    17 |       - |
|     **◯**  *MAX_ORDERS_PER_PARTICIPANT*            |       - |          - |   5,162 |     1 |       - |
|        *multicall*                                 | 187,255 |    707,994 | 447,625 |     4 |       - |
|     **◯**  *name*                                  |       - |          - |   8,227 |     1 |       - |
|     **◯**  *orderFee*                              |       - |          - |   7,277 |     6 |       - |
|        *removeMargin*                              |  61,693 |    141,066 |  95,721 |     4 |       - |
|     **◯**  *reservePoolBalance*                    |       - |          - |   7,230 |     4 |       - |
|        *setFeeDiscountPercent*                     |  31,490 |     51,402 |  44,765 |     3 |       - |
|        *setFutureDeliveryDatesCount*               |       - |          - |  33,753 |     5 |       - |
|        *setOrderFee*                               |  29,869 |     51,805 |  40,837 |     2 |       - |
|        *setValidatorURL*                           |       - |          - |  98,971 |     1 |       - |
|     **◯**  *speedHps*                              |       - |          - |   7,297 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   8,247 |     1 |       - |
|     **◯**  *token*                                 |       - |          - |   7,293 |     1 |       - |
|     **◯**  *validatorAddress*                      |       - |          - |   7,295 |     1 |       - |
|        *withdrawCollectedFees*                     |       - |          - |  58,143 |     1 |       - |
|        *withdrawDeliveryPayment*                   |  52,353 |     59,292 |  53,741 |     5 |       - |
|        *withdrawReservePool*                       |  51,328 |     64,160 |  57,744 |     2 |       - |
| **HashrateOracle**                                 |         |            |         |       |         |
|     **◯**  *getHashesForBTC*                       |       - |          - |  11,933 |    10 |       - |
|        *setHashesForBTC*                           |  38,566 |     72,778 |  41,684 |    11 |       - |
|        *setTTL*                                    |       - |          - |  73,680 |     1 |       - |
|        *setUpdaterAddress*                         |       - |          - |  51,005 |     1 |       - |
| **USDCMock**                                       |         |            |         |       |         |
|        *approve*                                   |       - |          - |  46,678 |     5 |       - |
|     **◯**  *balanceOf*                             |       - |          - |   2,582 |     6 |       - |
|     **◯**  *decimals*                              |       - |          - |     199 |     1 |       - |
|     **◯**  *symbol*                                |       - |          - |   3,107 |     1 |       - |
|        *transfer*                                  |  51,555 |     51,567 |  51,565 |     5 |       - |

## Deployments
|                        |     Min |    Max  |       Avg | Block % | usd avg |
| :--------------------- | ------: | ------: | --------: | ------: | ------: |
| **BTCPriceOracleMock** |       - |       - |   290,920 |     1 % |       - |
| **ERC1967Proxy**       | 180,478 | 375,158 |   277,818 |   0.9 % |       - |
| **Futures**            |       - |       - | 5,336,637 |  17.8 % |       - |
| **HashrateOracle**     |       - |       - | 1,162,419 |   3.9 % |       - |
| **Multicall3**         |       - |       - |   745,332 |   2.5 % |       - |
| **USDCMock**           |       - |       - |   547,884 |   1.8 % |       - |

## Solidity and Network Config
| **Settings**        | **Value**  |
| ------------------- | ---------- |
| Solidity: version   | 0.8.30     |
| Solidity: optimized | true       |
| Solidity: runs      | 800        |
| Solidity: viaIR     | false      |
| Block Limit         | 30,000,000 |
| Gas Price           | -          |
| Token Price         | -          |
| Network             | ETHEREUM   |
| Toolchain           | hardhat    |

