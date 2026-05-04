export const contractErrors = [
    {
      "inputs": [],
      "name": "InvalidPrice",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "OracleStale",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "MaxOrdersPerParticipantReached",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "message",
          "type": "string"
        }
      ],
      "name": "Error",
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
      "name": "InvalidQty",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "DeliveryDateShouldBeInTheFuture",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "OnlyValidator",
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
      "name": "DeliveryDateExpired",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "UnsupportedTokenDecimals",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PositionNotExists",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PositionDestURLNotSet",
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
      "inputs": [
        {
          "internalType": "uint256",
          "name": "code",
          "type": "uint256"
        }
      ],
      "name": "Panic",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PositionDeliveryExpired",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "StaleData",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "OnlyValidatorOrPositionParticipant",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "Unauthorized",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "DeliveryNotFinishedYet",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "DeliveryDateNotAvailable",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "OrderNotBelongToSender",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "spender",
          "type": "address"
        }
      ],
      "name": "ERC20InvalidSpender",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "CollateralTokenMismatch",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidOracle",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "sender",
          "type": "address"
        }
      ],
      "name": "ERC20InvalidSender",
      "type": "error"
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
      "name": "TransferDisabled",
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
      "name": "ERC1967NonPayable",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InsuranceFundNotConfigured",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ValueCannotBeZero",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NothingToWithdraw",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotImplemented",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FailedCall",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotInitializing",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InsufficientMarginBalance",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ZeroAddress",
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
          "internalType": "address",
          "name": "sender",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "balance",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "needed",
          "type": "uint256"
        }
      ],
      "name": "ERC20InsufficientBalance",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "approver",
          "type": "address"
        }
      ],
      "name": "ERC20InvalidApprover",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "receiver",
          "type": "address"
        }
      ],
      "name": "ERC20InvalidReceiver",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidInitialization",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PositionAlreadyPaid",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "spender",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "allowance",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "needed",
          "type": "uint256"
        }
      ],
      "name": "ERC20InsufficientAllowance",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PositionDeliveryNotStartedYet",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "OnlyPositionBuyer",
      "type": "error"
    },
    // ── External errors bubbled up from collateral-margin (CollateralVault /
    // PortfolioMarginEngine) ──────────────────────────────────────────────────
    // viem decodes a revert by selector against whatever ABI is supplied to the
    // call site. Futures' new code paths (createOrder fee charge, position
    // settlement, liquidation, etc.) re-enter into the vault's `internalTransfer*`
    // and the engine's `computePortfolioIM`, so their custom errors must be
    // merged into the Futures ABI on the UI side or viem prints the raw selector.
    //
    // 0xea8e4eb5 — emitted by CollateralVault when the caller is not registered
    // via `setAuthorizedCaller`. Hits every futures action that moves funds in
    // the vault until the vault owner whitelists the futures proxy.
    {
      "inputs": [],
      "name": "NotAuthorized",
      "type": "error"
    }
  ] as const;