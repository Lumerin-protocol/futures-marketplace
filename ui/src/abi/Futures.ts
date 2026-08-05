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
    "name": "ArrayLengthMismatch",
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
    "name": "ExpirationDateNotAvailable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ExpirationDateShouldBeInTheFuture",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FailedCall",
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
    "name": "InvalidReduceQuantity",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidTimeInForce",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxOrdersPerParticipantReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxPriceLevelsReached",
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
    "name": "OracleStale",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OrderNotBelongToSender",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OrderNotBelongToUser",
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
    "inputs": [],
    "name": "OverLiquidation",
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
    "name": "PositionExpirationNotStartedYet",
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
    "name": "TimeInForceNotFilled",
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
        "name": "user",
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
            "name": "futureExpirationDatesCount",
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
        "name": "orderId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "participant",
        "type": "address"
      }
    ],
    "name": "OrderCancelled",
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
        "internalType": "uint256",
        "name": "price",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "quantity",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "expirationAt",
        "type": "uint256"
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
        "name": "user",
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
        "internalType": "bytes32",
        "name": "makerOrderId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "maker",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "taker",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "expirationAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "tradePrice",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "takerQuantity",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "makerFee",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "takerFee",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "makerNetQtyAfter",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "takerNetQtyAfter",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "makerEntryPriceAfter",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "takerEntryPriceAfter",
        "type": "uint256"
      }
    ],
    "name": "OrderMatched",
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
        "internalType": "int256",
        "name": "newQuantity",
        "type": "int256"
      }
    ],
    "name": "OrderUpdated",
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
        "internalType": "address",
        "name": "user",
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
        "name": "expirationAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "closedQuantity",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "pnl",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "liquidatorFee",
        "type": "uint256"
      }
    ],
    "name": "PositionLiquidated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "expirationAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "closedQuantity",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "pnl",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "settlementPrice",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "settledBy",
        "type": "address"
      }
    ],
    "name": "PositionSettled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "expirationAt",
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
    "name": "CONTRACT_SIZE_HPS_DAY",
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
    "name": "EXPIRATION_INTERVAL_DAYS",
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
    "name": "MAX_PRICE_LEVELS_PER_SIDE",
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
    "name": "ORACLE_UNIT_HPS_DAY",
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
    "inputs": [],
    "name": "_gap7",
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
        "internalType": "bytes32",
        "name": "_orderId",
        "type": "bytes32"
      }
    ],
    "name": "cancelOrder",
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
        "name": "_expirationAt",
        "type": "uint256"
      },
      {
        "internalType": "int256",
        "name": "_quantity",
        "type": "int256"
      },
      {
        "internalType": "enum Futures.TimeInForce",
        "name": "_tif",
        "type": "uint8"
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
            "name": "price",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expirationAt",
            "type": "uint256"
          },
          {
            "internalType": "int256",
            "name": "quantity",
            "type": "int256"
          },
          {
            "internalType": "enum Futures.TimeInForce",
            "name": "timeInForce",
            "type": "uint8"
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
    "name": "expirationIntervalDays",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "firstFutureExpirationDate",
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
    "name": "futureExpirationDatesCount",
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
        "internalType": "address",
        "name": "_user",
        "type": "address"
      }
    ],
    "name": "getActiveExpirationDates",
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
        "name": "_expirationAt",
        "type": "uint256"
      }
    ],
    "name": "getBestAskPrice",
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
        "name": "_expirationAt",
        "type": "uint256"
      }
    ],
    "name": "getBestBidPrice",
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
    "name": "getExpirationDates",
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
    "name": "getOrder",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "participant",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "price",
            "type": "uint256"
          },
          {
            "internalType": "int256",
            "name": "quantity",
            "type": "int256"
          },
          {
            "internalType": "uint256",
            "name": "expirationAt",
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
        "internalType": "uint256",
        "name": "_expirationAt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_maxLevels",
        "type": "uint256"
      }
    ],
    "name": "getOrderBookPrices",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "bids",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "asks",
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
        "name": "_expirationAt",
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
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "getUnrealizedPnl",
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
        "internalType": "address",
        "name": "_user",
        "type": "address"
      }
    ],
    "name": "getUserOrders",
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
        "name": "_user",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_expirationAt",
        "type": "uint256"
      }
    ],
    "name": "getUserPosition",
    "outputs": [
      {
        "components": [
          {
            "internalType": "int256",
            "name": "netQuantity",
            "type": "int256"
          },
          {
            "internalType": "int256",
            "name": "netEntryValue",
            "type": "int256"
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
        "name": "_minimumPriceIncrement",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "_futureExpirationDatesCount",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "_firstFutureExpirationDate",
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
        "name": "_user",
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
        "name": "_user",
        "type": "address"
      },
      {
        "internalType": "bytes32[]",
        "name": "_orderIds",
        "type": "bytes32[]"
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
        "name": "_user",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_expirationAt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_closeQty",
        "type": "uint256"
      }
    ],
    "name": "liquidatePosition",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_user",
        "type": "address"
      },
      {
        "internalType": "uint256[]",
        "name": "_expirationAts",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "_closeQtys",
        "type": "uint256[]"
      }
    ],
    "name": "liquidatePositions",
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
        "internalType": "uint256",
        "name": "expirationAt",
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
      },
      {
        "internalType": "int256",
        "name": "_newQuantity",
        "type": "int256"
      }
    ],
    "name": "reduceOrderSize",
    "outputs": [],
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
        "name": "_futureExpirationDatesCount",
        "type": "uint8"
      }
    ],
    "name": "setFutureExpirationDatesCount",
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
        "internalType": "address",
        "name": "_user",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_expirationAt",
        "type": "uint256"
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
        "internalType": "address[]",
        "name": "_users",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "_expirationAts",
        "type": "uint256[]"
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
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_expirationAt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      },
      {
        "internalType": "int256",
        "name": "_quantity",
        "type": "int256"
      }
    ],
    "name": "simulateOrder",
    "outputs": [
      {
        "internalType": "int256",
        "name": "filledQuantity",
        "type": "int256"
      },
      {
        "internalType": "uint256",
        "name": "averageFillPrice",
        "type": "uint256"
      },
      {
        "internalType": "int256",
        "name": "remainingQuantity",
        "type": "int256"
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
        "internalType": "bytes32[]",
        "name": "_cancelIds",
        "type": "bytes32[]"
      },
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "orderId",
            "type": "bytes32"
          },
          {
            "internalType": "int256",
            "name": "newQuantity",
            "type": "int256"
          }
        ],
        "internalType": "struct Futures.ReduceIntent[]",
        "name": "_reduces",
        "type": "tuple[]"
      },
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "price",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expirationAt",
            "type": "uint256"
          },
          {
            "internalType": "int256",
            "name": "quantity",
            "type": "int256"
          },
          {
            "internalType": "enum Futures.TimeInForce",
            "name": "timeInForce",
            "type": "uint8"
          }
        ],
        "internalType": "struct Futures.OrderIntent[]",
        "name": "_intents",
        "type": "tuple[]"
      }
    ],
    "name": "updateOrders",
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
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_participant",
        "type": "address"
      }
    ],
    "name": "getRiskView",
    "outputs": [
      {
        "components": [
          {
            "internalType": "int256",
            "name": "netPositionDelta",
            "type": "int256"
          },
          {
            "internalType": "int256",
            "name": "unrealizedPnl",
            "type": "int256"
          },
          {
            "internalType": "int256",
            "name": "pendingFunding",
            "type": "int256"
          },
          {
            "internalType": "uint256",
            "name": "buyOrderDelta",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "sellOrderDelta",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "buyOrderFillLoss",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "sellOrderFillLoss",
            "type": "uint256"
          }
        ],
        "internalType": "struct ILinearMarket.RiskView",
        "name": "view_",
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
    "name": "getOrderValues",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "buyValue",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "sellValue",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "InvalidFee",
    "type": "error"
  }
] as const;
