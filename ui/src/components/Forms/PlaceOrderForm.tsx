import { memo, type FC, useCallback, useState, useEffect } from "react";
import { useForm, useController, useWatch, type Control } from "react-hook-form";
import { waitForOrderBookBlockNumber, getOrderBookQueryKey } from "../../hooks/data/orderBookHelpers";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TransactionReceipt } from "viem";
import { useCreateOrder } from "../../hooks/data/useCreateOrder";
import { useCreatePerpsOrder } from "../../hooks/data/perps/useCreatePerpsOrder";
import { PARTICIPANT_QK } from "../../hooks/data/useParticipant";
import { POSITION_BOOK_QK } from "../../hooks/data/usePositionBook";
import { USER_PERPS_ORDERS_QK } from "../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../hooks/data/perps/useUserPositionSessions";
import { USER_PERPS_TRADES_QK } from "../../hooks/data/perps/useUserPerpsTrades";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { formatStratumUrl } from "../../utils/formatters";
import { isValidHost, isValidUsername } from "../../utils/validators";
import styled from "@mui/material/styles/styled";
import { tokens } from "../../styles/tokens";
import type { Participant } from "../../hooks/data/useParticipant";
import type { ContractMode } from "../../types/types";
import { useFuturesContractSpecs } from "../../hooks/data/useFuturesContractSpecs";
import { calculateMinMargin } from "../../hooks/data/useGetMinMarginForPosition";
import { getMinMarginForPositionManual } from "../../hooks/data/getMinMarginForPositionManual";
import { predefinedPools } from "./BuyerForms/predefinedPools";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useOrderFee } from "../../hooks/data/useOrderFee";
import type { PerpsCollection } from "../../hooks/data/perps/usePerpsCollection";

interface PoolFormValues {
  predefinedPoolIndex: number | "";
  poolAddress: string;
  username: string;
}

interface Props {
  price: bigint;
  deliveryDate: bigint;
  quantity: number; // Positive for Buy, Negative for Sell
  participantData?: Participant | null;
  latestPrice: bigint | null;
  onOrderPlaced?: () => void | Promise<void>;
  closeForm: () => void;
  bypassConflictCheck?: boolean; // Allow proceeding despite conflicting orders
  contractMode?: ContractMode;
  perpsCollection?: PerpsCollection;
  leverage?: number; // Leverage value for perps mode (e.g., 10 for 10x)
  isMarketOrder?: boolean;
}

export const PlaceOrderForm: FC<Props> = ({
  price,
  deliveryDate,
  quantity,
  participantData,
  latestPrice,
  onOrderPlaced,
  closeForm,
  bypassConflictCheck = false,
  contractMode = "futures",
  perpsCollection,
  leverage = 10,
  isMarketOrder = false,
}) => {
  // Conditionally use futures or perps create order hook
  const futuresCreateOrder = useCreateOrder();
  const perpsCreateOrder = useCreatePerpsOrder();
  const { createOrderAsync } = contractMode == "perpetual" ? perpsCreateOrder : futuresCreateOrder;
  
  const qc = useQueryClient();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const contractSpecsQuery = useFuturesContractSpecs();
  const { orderFeeUSDC, isLoading: isOrderFeeLoading } = useOrderFee(address);

  // Determine order type from quantity sign
  const isBuy = quantity > 0;
  const absoluteQuantity = Math.abs(quantity);
  const deliveryDurationDays = contractSpecsQuery.data?.data?.deliveryDurationDays ?? 7;
  const marginPersent = contractSpecsQuery.data?.data?.liquidationMarginPercent ?? 20;

  // State for required margin
  const [requiredMargin, setRequiredMargin] = useState<bigint | null>(null);
  const [isLoadingMargin, setIsLoadingMargin] = useState(false);

  // Calculate required margin when price or quantity changes
  useEffect(() => {
    if (!latestPrice) return;
    setIsLoadingMargin(true);
    
    let margin: bigint;
    if (contractMode === "perpetual") {
      // For perps: calculate margin based on leverage
      // Formula: (price * quantity) * (1 / leverage)
      // Example: 10x leverage = 10% margin, 5x leverage = 20% margin
      const positionValue = price * BigInt(Math.round(absoluteQuantity * 1e6)) / 1000000n;
      const marginPercent = BigInt(Math.round((1 / leverage) * 100)); // Convert leverage to margin %
      margin = (positionValue * marginPercent) / 100n;
    } else {
      // For futures: use the existing calculation with PnL
      margin = getMinMarginForPositionManual(price, quantity, latestPrice, marginPersent, deliveryDurationDays);
    }
    
    setRequiredMargin(margin);
    setIsLoadingMargin(false);
  }, [latestPrice, price, quantity, contractMode, absoluteQuantity, marginPersent, deliveryDurationDays, leverage]);

  // Check for conflicting orders (opposite action, same price, same delivery date)
  const hasConflictingOrder = () => {
    if (!participantData?.orders) return false;

    const priceInWei = price;
    const deliveryDateValue = deliveryDate;
    const oppositeIsBuy = !isBuy;

    return participantData.orders.some(
      (order) =>
        order.isActive &&
        order.isBuy === oppositeIsBuy &&
        order.pricePerDay === priceInWei &&
        order.deliveryAt === deliveryDateValue,
    );
  };

  // State for checkbox to show pool input form
  const [hidePoolInput, setHidePoolInput] = useState(true);

  // Form setup for pool address and username (optional for buy orders)
  const form = useForm<PoolFormValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    defaultValues: {
      predefinedPoolIndex: "" as const,
      poolAddress: "",
      username: "",
    },
  });

  // Optional input form for buy orders to set pool address and username
  // Use useCallback to prevent recreation on each render, which causes input focus loss
  const inputForm = useCallback(
    () => (
      <PoolInputForm
        key="pool-input-form"
        control={form.control}
        setValue={form.setValue}
        resetField={form.resetField}
      />
    ),
    [form.control, form.setValue, form.resetField],
  );

  // Construct stratum URL if pool address is provided
  const getDestUrl = (): string => {
    if (!isBuy) {
      return "";
    }

    const formValues = form.getValues();
    const poolAddress = formValues.poolAddress;
    const username = formValues.username;

    if (!poolAddress) {
      return "";
    }

    // If both pool address and username are provided, construct stratum URL
    if (poolAddress && username) {
      return formatStratumUrl({
        host: poolAddress,
        username: username,
      });
    }

    // If only pool address is provided, construct URL without username
    if (poolAddress) {
      return formatStratumUrl({
        host: poolAddress,
      });
    }

    return "";
  };

  return (
    <TransactionForm
      onClose={closeForm}
      title={isBuy ? "Place Bid Order" : "Place Ask Order"}
      description={""}
      validateInput={
        isBuy && !hidePoolInput
          ? async () => {
              const result = await form.trigger();
              return result;
            }
          : undefined
      }
      reviewForm={(props) => (
        <>
          <div className="mb-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-300">{contractMode === "futures" ? "Price Per Day:" : "Price:"}</span>
                <span className="text-white">
                  {isMarketOrder ? "Market" : `${Number(price) / 1e6} USDC`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Quantity:</span>
                <span className="text-white">{absoluteQuantity.toFixed(6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Size:</span>
                <span className="text-white">
                  {((Number(price) / 1e6) * absoluteQuantity).toFixed(2)} USDC
                </span>
              </div>
              {contractMode === "futures" && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Delivery Date:</span>
                  <span className="text-white">{new Date(Number(deliveryDate) * 1000).toLocaleString()}</span>
                </div>
              )}
              {contractMode === "futures" && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Expected Hashrate:</span>
                  <span className="text-white">{absoluteQuantity * 100} Th/s</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-300">Required Margin:</span>
                <span className="text-white">
                  {requiredMargin !== null
                    ? `${(Math.abs(Number(requiredMargin)) / 1e6).toFixed(2)} USDC`
                    : isLoadingMargin
                      ? "Loading..."
                      : "N/A"}
                </span>
              </div>
              {contractMode === "perpetual" ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Maker Fee:</span>
                    <span className="text-white">
                      {perpsCollection?.makerFeeBps !== undefined 
                        ? `${(perpsCollection.makerFeeBps / 100).toFixed(2)}%` 
                        : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Taker Fee:</span>
                    <span className="text-white">
                      {perpsCollection?.takerFeeBps !== undefined 
                        ? `${(perpsCollection.takerFeeBps / 100).toFixed(2)}%` 
                        : "N/A"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <span className="text-gray-300">Order Creation Fee:</span>
                  <span className="text-white">
                    {orderFeeUSDC !== null ? `${orderFeeUSDC.toFixed(2)} USDC` : isOrderFeeLoading ? "Loading..." : "N/A"}
                  </span>
                </div>
              )}
            </div>
          </div>
          {isBuy && contractMode === "futures" && (
            <div className="mb-4">
              <CheckboxContainer>
                <CheckboxInput
                  type="checkbox"
                  id="no-hashrate-checkbox"
                  checked={hidePoolInput}
                  onChange={(e) => setHidePoolInput(e.target.checked)}
                />
                <CheckboxLabel htmlFor="no-hashrate-checkbox">I do not intend to receive hashrate.</CheckboxLabel>
              </CheckboxContainer>
              {!hidePoolInput && <div className="mt-4">{inputForm()}</div>}
            </div>
          )}
          <p className="text-gray-400 text-sm">
            You are about to place a {isBuy ? "bid" : "ask"} order. Please review the details above.
          </p>
        </>
      )}
      resultForm={(props) => (
        <>
          <p className="w-6/6 text-left font-normal text-s mt-5">
            Your order has been placed and will appear in the order book shortly.
          </p>
        </>
      )}
      transactionSteps={[
        {
          label: `Place ${isBuy ? "Bid" : "Ask"} Order`,
          action: async () => {
            // Check for conflicting order before proceeding (unless bypassed)
            if (!bypassConflictCheck && hasConflictingOrder()) {
              const oppositeAction = isBuy ? "Ask" : "Bid";
              const priceInUSDC = Number(price) / 1e6;
              throw new Error(
                `Cannot create ${isBuy ? "Bid" : "Ask"} order at price ${priceInUSDC} USDC. You already have an active ${oppositeAction} order at the same price and delivery date. Please close or modify the existing order first.`,
              );
            }

            const destUrl = getDestUrl();
            let txhash;
            if (contractMode === "perpetual") {
              // Perps only needs price and quantity
              txhash = await (createOrderAsync as any)({
                price,
                quantity,
              });
            } else {
              // Futures needs price, deliveryDate, quantity, and destUrl
              txhash = await (createOrderAsync as any)({
                price,
                deliveryDate,
                quantity,
                destUrl,
              });
            }
            return {
              isSkipped: false,
              txhash: txhash,
            };
          },
          postConfirmation: async (receipt: TransactionReceipt) => {
            // Wait for block number to ensure indexer has updated
            await waitForOrderBookBlockNumber(receipt.blockNumber, qc, contractMode, Number(deliveryDate));

            // Invalidate queries based on contract mode
            if (contractMode === "perpetual") {
              // For perps, invalidate perps-specific queries
              await Promise.all([
                qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                address && qc.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, address] }),
                address && qc.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, address] }),
                address && qc.invalidateQueries({ queryKey: [USER_PERPS_TRADES_QK, address] }),
                // address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
              ]);
            } else {
              // For futures, invalidate futures-specific queries
              await Promise.all([
                qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                address && qc.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
                address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
              ]);
            }

            if (onOrderPlaced) {
              await onOrderPlaced();
            }
          },
        },
      ]}
    />
  );
};

const PoolInputContainer = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-bottom: 1rem;
`;

const PoolSelectWrapper = styled("div")`
  .MuiTextField-root {
    width: 100%;
  }
  
  .MuiInputBase-root {
    background: ${tokens.overlay.white05};
    color: ${tokens.text.onDark};
    
    &:hover {
      background: ${tokens.overlay.white08};
    }
  }
  
  .MuiInputLabel-root {
    color: ${tokens.text.secondary};
  }
  
  .MuiOutlinedInput-notchedOutline {
    border-color: ${tokens.overlay.white20};
  }
  
  .MuiSelect-icon {
    color: ${tokens.text.secondary};
  }
`;

const InputGroup = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: ${tokens.text.secondary};
  }

  input {
    padding: 0.75rem;
    border: 1px solid ${tokens.border.default};
    border-radius: ${tokens.radius.sm};
    background: ${tokens.surface.inputIsland};
    color: ${tokens.text.onDark};
    font-size: 0.875rem;
    transition: border-color 0.2s ease, background-color 0.2s ease;
    width: 100%;
    min-width: 65px;

    &:focus {
      outline: none;
      border-color: ${tokens.brand.blue};
      background: ${tokens.overlay.white08};
    }

    &::placeholder {
      color: ${tokens.text.muted};
    }
  }
`;

const ErrorText = styled("span")`
  color: ${tokens.trading.short};
  font-size: 0.75rem;
  margin-top: -0.25rem;
`;

const CheckboxContainer = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid ${tokens.overlay.white20};
  border-radius: 6px;
  background: ${tokens.overlay.white05};
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;

  &:hover {
    background: ${tokens.overlay.white08};
    border-color: ${tokens.overlay.white30};
  }
`;

const CheckboxInput = styled("input")`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: ${tokens.accent.main};
`;

const CheckboxLabel = styled("label")`
  font-size: 0.875rem;
  color: ${tokens.text.onDark};
  cursor: pointer;
  user-select: none;
`;

// Helper function to determine pool type
function getPoolType(predefinedPoolIndex: number | ""): "manual" | "pool" | null {
  if (predefinedPoolIndex === "") {
    return null;
  }
  if (predefinedPoolIndex === -1) {
    return "manual";
  }
  return "pool";
}

// Separate memoized component to prevent input focus loss
const PoolInputForm = memo<{
  control: Control<PoolFormValues>;
  setValue: (name: keyof PoolFormValues, value: string) => void;
  resetField: (name: keyof PoolFormValues) => void;
}>(({ control, setValue, resetField }) => {
  const predefinedPoolController = useController({
    name: "predefinedPoolIndex",
    control: control,
    rules: {
      required: "Please select a pool",
      onChange: (event) => {
        const value = event.target.value;
        const poolType = getPoolType(value);

        if (poolType === "pool") {
          setValue("poolAddress", predefinedPools[value].address);
        }

        if (poolType === "manual") {
          resetField("poolAddress");
        }
      },
    },
  });

  const poolAddressController = useController({
    name: "poolAddress",
    control: control,
    rules: {
      required: "Pool Address is required",
      validate: (poolAddress: string) => {
        if (!poolAddress) {
          return true; // Optional field
        }
        if (isValidHost(poolAddress)) {
          return true;
        }
        return "Pool address should have the format: mypool.com:3333";
      },
    },
  });

  const usernameController = useController({
    name: "username",
    control: control,
    rules: {
      validate: (username: string) => {
        if (!username) {
          return true; // Optional field
        }
        if (isValidUsername(username)) {
          return true;
        }
        return "Invalid username. Only letters a-z, numbers and .@- allowed";
      },
    },
  });

  const predefinedPoolIndex = useWatch({ control, name: "predefinedPoolIndex" });
  const isManualPool = predefinedPoolIndex !== "" && getPoolType(predefinedPoolIndex) === "manual";

  return (
    <PoolInputContainer>
      <p className="text-gray-400 text-sm mb-4">
        Configure the pool address and username to which your purchased hashpower will be directed.
      </p>
      <PoolSelectWrapper>
        <TextField
          select
          {...predefinedPoolController.field}
          label="Predefined Pools"
          error={!!predefinedPoolController.fieldState.error}
          helperText={predefinedPoolController.fieldState.error?.message}
          fullWidth
        >
          {predefinedPools.map((item, index) =>
            item.isLightning ? null : (
              <MenuItem key={item.name} value={index}>
                {item.name}
              </MenuItem>
            ),
          )}
          <MenuItem key="-1" value={-1}>
            Manually enter pool address
          </MenuItem>
        </TextField>
      </PoolSelectWrapper>
      <InputGroup>
        <label>Pool Address</label>
        <input type="text" {...poolAddressController.field} placeholder="mypool.com:3333" disabled={!isManualPool} />
        {poolAddressController.fieldState.error && (
          <ErrorText>{poolAddressController.fieldState.error.message}</ErrorText>
        )}
      </InputGroup>
      <InputGroup>
        <label>Username</label>
        <input type="text" {...usernameController.field} placeholder="account.worker" />
        {usernameController.fieldState.error && <ErrorText>{usernameController.fieldState.error.message}</ErrorText>}
      </InputGroup>
    </PoolInputContainer>
  );
});

PoolInputForm.displayName = "PoolInputForm";
