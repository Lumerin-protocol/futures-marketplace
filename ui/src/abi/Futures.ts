export const FuturesAbi = [
  {
    "inputs": [
      {
        "internalType": "contract ICollateralVault",
        "name": "_collateralVault",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "target",
        "type": "address"
      }
    ],
    "name": "AddressEmptyCode",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CollateralTokenMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DeliveryDateExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DeliveryDateNotAvailable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DeliveryDateShouldBeInTheFuture",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DeliveryNotFinishedYet",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "implementation",
        "type": "address"
      }
    ],
    "name": "ERC1967InvalidImplementation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ERC1967NonPayable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FailedCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "reserve",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "required",
        "type": "uint256"
      }
    ],
    "name": "InsufficientContractReserve",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientMarginBalance",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsuranceFundNotConfigured",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidInitialization",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidOracle",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPrice",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidQty",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxOrdersPerParticipantReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotInitializing",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotLiquidatable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NothingToWithdraw",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlyPositionBuyer",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlyValidatorOrPositionParticipant",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OracleStale",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OrderNotBelongToParticipant",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OrderNotBelongToSender",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OrderNotExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OrderNotExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OrdersStillOpen",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "OwnableInvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PositionAlreadyPaid",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PositionDeliveryExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PositionDeliveryNotExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PositionDeliveryNotStartedYet",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PositionDestURLNotSet",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PositionNotBelongToParticipant",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PositionNotExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SettlementDateNotReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferDisabled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UUPSUnauthorizedCallContext",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "slot",
        "type": "bytes32"
      }
    ],
    "name": "UUPSUnsupportedProxiableUUID",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnsupportedTokenDecimals",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "int256",
        "name": "min",
        "type": "int256"
      },
      {
        "internalType": "int256",
        "name": "max",
        "type": "int256"
      }
    ],
    "name": "ValueOutOfRange",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "BadDebt",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "makerFee",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "takerFee",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "liquidationFee",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minimumPriceIncrement",
            "type": "uint256"
          },
          {
            "internalType": "uint8",
            "name": "liquidationMarginPercent",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "futureDeliveryDatesCount",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "hashrateOracle",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "marginEngine",
            "type": "address"
          }
        ],
        "indexed": false,
        "internalType": "struct Futures.Config",
        "name": "config",
        "type": "tuple"
      }
    ],
    "name": "ConfigUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "hook",
        "type": "address"
      }
    ],
    "name": "HookUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "version",
        "type": "uint64"
      }
    ],
    "name": "Initialized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "lotId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "seller",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "buyer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "sellerPnl",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "buyerPnl",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "closedBy",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum Futures.LotCloseReason",
        "name": "reason",
        "type": "uint8"
      }
    ],
    "name": "LotClosed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "lotId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "seller",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "buyer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "pricePerDay",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "deliveryAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "makerOrderId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "takerOrderId",
        "type": "bytes32"
      }
    ],
    "name": "LotCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "lotId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "participant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "liquidator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "fee",
        "type": "uint256"
      }
    ],
    "name": "LotLiquidated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "oldLotId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "newLotId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "exitingParticipant",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "newParticipant",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "exitPnl",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newSellPricePerDay",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newBuyPricePerDay",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "makerOrderId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "takerOrderId",
        "type": "bytes32"
      }
    ],
    "name": "LotTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "orderId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "enum Futures.OrderCloseReason",
        "name": "reason",
        "type": "uint8"
      }
    ],
    "name": "OrderClosed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "orderId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "participant",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "destURL",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "pricePerDay",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "deliveryAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isBuy",
        "type": "bool"
      }
    ],
    "name": "OrderCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "orderId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "participant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "liquidator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "fee",
        "type": "uint256"
      }
    ],
    "name": "OrderLiquidated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "deliveryAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "price",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "recordedBy",
        "type": "address"
      }
    ],
    "name": "SettlementPriceRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "implementation",
        "type": "address"
      }
    ],
    "name": "Upgraded",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "BREACH_PENALTY_DECIMALS",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_ORACLE_STALENESS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_ORDERS_PER_PARTICIPANT",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_ORDER_QTY",
    "outputs": [
      {
        "internalType": "int8",
        "name": "",
        "type": "int8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "UPGRADE_INTERFACE_VERSION",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "VERSION",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
<<<<<<< Updated upstream
    "inputs": [],
    "name": "breachPenaltyRatePerDay",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "_positionId",
        "type": "bytes32"
      }
    ],
    "name": "cancelExpiredPosition",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "_positionId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "_blameSeller",
        "type": "bool"
      }
    ],
    "name": "closeDelivery",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
=======
>>>>>>> Stashed changes
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "_orderId",
        "type": "bytes32"
      }
    ],
    "name": "closeOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "collateralVault",
    "outputs": [
      {
        "internalType": "contract ICollateralVault",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "collectedFeesBalance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_deliveryDate",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "_destURL",
        "type": "string"
      },
      {
        "internalType": "int8",
        "name": "_qty",
        "type": "int8"
      }
    ],
    "name": "createOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "pricePerDay",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deliveryDate",
            "type": "uint256"
          },
          {
            "internalType": "string",
            "name": "destURL",
            "type": "string"
          },
          {
            "internalType": "int8",
            "name": "qty",
            "type": "int8"
          }
        ],
        "internalType": "struct Futures.OrderIntent[]",
        "name": "_intents",
        "type": "tuple[]"
      }
    ],
    "name": "createOrders",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "deliveryDurationDays",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "deliveryIntervalDays",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "firstFutureDeliveryDate",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "futureDeliveryDatesCount",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_deliveryDate",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_maxLevels",
        "type": "uint256"
      }
    ],
    "name": "getAskPrices",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_deliveryDate",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_maxLevels",
        "type": "uint256"
      }
    ],
    "name": "getBidPrices",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getDeliveryDates",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "getFuturesOrderMargin",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "getFuturesUnrealizedPnl",
    "outputs": [
      {
        "internalType": "int256",
        "name": "",
        "type": "int256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getMarketPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "getNetPositionDelta",
    "outputs": [
      {
        "internalType": "int256",
        "name": "",
        "type": "int256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "_orderId",
        "type": "bytes32"
      }
    ],
    "name": "getOrderById",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "isBuy",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "participant",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "destURL",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "pricePerDay",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deliveryAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          }
        ],
        "internalType": "struct Futures.Order",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "getOrderIds",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "_positionId",
        "type": "bytes32"
      }
    ],
    "name": "getPositionById",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "seller",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "buyer",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "destURL",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "sellPricePerDay",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "buyPricePerDay",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deliveryAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "paid",
            "type": "bool"
          }
        ],
        "internalType": "struct Futures.Position",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "getPositionIds",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_deliveryDate",
        "type": "uint256"
      }
    ],
    "name": "getPositionsByParticipantDeliveryDate",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_deliveryDate",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "_isBid",
        "type": "bool"
      }
    ],
    "name": "getQuantityAtPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "hashpriceScalingDivisor",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "hashrateOracle",
    "outputs": [
      {
        "internalType": "contract AggregatorV3Interface",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "hook",
    "outputs": [
      {
        "internalType": "contract IPointsHook",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "contract AggregatorV3Interface",
        "name": "_hashrateOracle",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "_liquidationMarginPercent",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "_speedHps",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_minimumPriceIncrement",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "_deliveryDurationDays",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "_deliveryIntervalDays",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "_futureDeliveryDatesCount",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "_firstFutureDeliveryDate",
        "type": "uint256"
      }
    ],
    "name": "initialize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "isLiquidatable",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "_orderId",
        "type": "bytes32"
      }
    ],
    "name": "liquidateOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "liquidateOrders",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "_positionId",
        "type": "bytes32"
      }
    ],
    "name": "liquidatePosition",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "liquidationFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "liquidationMarginPercent",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "makerFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "marginEngine",
    "outputs": [
      {
        "internalType": "contract IPortfolioMarginEngine",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minimumPriceIncrement",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes[]",
        "name": "data",
        "type": "bytes[]"
      }
    ],
    "name": "multicall",
    "outputs": [
      {
        "internalType": "bytes[]",
        "name": "results",
        "type": "bytes[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "proxiableUUID",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
<<<<<<< Updated upstream
        "internalType": "bytes32",
        "name": "_orderId",
        "type": "bytes32"
      }
    ],
=======
        "internalType": "uint256",
        "name": "deliveryAt",
        "type": "uint256"
      }
    ],
    "name": "recordSettlementPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "price",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "_orderId",
        "type": "bytes32"
      }
    ],
>>>>>>> Stashed changes
    "name": "removeOutdatedOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "renounceOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address[]",
        "name": "_participants",
        "type": "address[]"
      }
    ],
    "name": "resetState",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "_futureDeliveryDatesCount",
        "type": "uint8"
      }
    ],
    "name": "setFutureDeliveryDatesCount",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_hook",
        "type": "address"
      }
    ],
    "name": "setHook",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_hook",
        "type": "address"
      }
    ],
    "name": "setHook",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_liquidationFee",
        "type": "uint256"
      }
    ],
    "name": "setLiquidationFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "_liquidationMarginPercent",
        "type": "uint8"
      }
    ],
    "name": "setLiquidationMarginPercent",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_makerFee",
        "type": "uint256"
      }
    ],
    "name": "setMakerFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_marginEngine",
        "type": "address"
      }
    ],
    "name": "setMarginEngine",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "addr",
        "type": "address"
      }
    ],
    "name": "setOracle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_takerFee",
        "type": "uint256"
      }
    ],
    "name": "setTakerFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "_positionId",
        "type": "bytes32"
      }
    ],
    "name": "settlePosition",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32[]",
        "name": "_positionIds",
        "type": "bytes32[]"
      }
    ],
    "name": "settlePositions",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "settlementPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "speedHps",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "takerFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newImplementation",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      }
    ],
    "name": "upgradeToAndCall",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawCollectedFees",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;