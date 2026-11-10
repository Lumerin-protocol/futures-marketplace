import { tokens } from "../../styles/tokens";
import { type FC, useCallback, useMemo } from "react";
import { useController, useForm, type Control } from "react-hook-form";
import { useAccount } from "wagmi";
import { getAddress, isAddress, parseUnits, zeroAddress } from "viem";
import { Tooltip } from "../Tooltip";
import { TextField } from "../TextField";
import { useRemoveMargin } from "../../hooks/data/useRemoveMargin";
import {
  useAddMarginWithPermit,
  useApproveAddMargin,
  useDepositFor,
  usePermitAddMargin,
} from "../../hooks/data/useAddMargin";
import { useFuturesCollateralVault } from "../../hooks/data/useFuturesCollateralVault";
import type { PermitSignature } from "../../hooks/data/usePermit";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import { AmountInputForm } from "./Shared/AmountInputForm";
import { InputWrapper } from "./Shared/Forms.styled";
import { formatValue, PAYMENT_TOKEN_SCALE_NUM, paymentToken } from "../../lib/units";
import { HelpOutlineIcon } from "../icons";
import type { TransactionStep, TxState } from "../../hooks/useTxForm";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface SendCollateralFormProps {
  closeForm: () => void;
  /// Locked margin enforced by the active contract engine; deducted from the
  /// total balance to determine the maximum sendable amount (same as withdraw).
  lockedAmount: bigint | null;
  isLoadingLockedAmount: boolean;
  isLockedAmountError?: boolean;
  lockedTooltip?: string;
  balanceQuery: BalanceQueryResult;
}

interface InputValues {
  amount: string;
  recipient: string;
}

/** What the Authorize step did, read back by the depositFor step. */
type AuthorizeState =
  | { mode: "permit"; signature: PermitSignature; deadline: bigint }
  | { mode: "approve" };

const normalizeRecipient = (value: string): `0x${string}` | null => {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) return null;
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
};

export const SendCollateralForm: FC<SendCollateralFormProps> = ({
  closeForm,
  lockedAmount,
  isLoadingLockedAmount,
  isLockedAmountError = false,
  lockedTooltip,
  balanceQuery,
}) => {
  const { address } = useAccount();
  const { removeMarginAsync } = useRemoveMargin();
  const { approveAsync } = useApproveAddMargin();
  const { depositForAsync } = useDepositFor();
  const { addMarginWithPermitAsync } = useAddMarginWithPermit();
  const { signPermit, isSupported: isPermitSupported } = usePermitAddMargin();
  const { data: vaultAddress } = useFuturesCollateralVault();
  const spenderAddress = vaultAddress as `0x${string}` | undefined;

  const lockedDisplayAmount = useMemo(() => {
    return lockedAmount && lockedAmount > 0n ? lockedAmount : 0n;
  }, [lockedAmount]);

  const availableBalance = useMemo(() => {
    if (balanceQuery.data === undefined || isLoadingLockedAmount || isLockedAmountError) return undefined;
    const balance = balanceQuery.data;
    return balance > lockedDisplayAmount ? balance - lockedDisplayAmount : 0n;
  }, [balanceQuery.data, lockedDisplayAmount, isLoadingLockedAmount, isLockedAmountError]);

  const form = useForm<InputValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    defaultValues: {
      amount: "",
      recipient: "",
    },
  });

  const recipientController = useController({
    name: "recipient",
    control: form.control,
    rules: {
      validate: (value) => {
        const recipient = normalizeRecipient(value);
        if (!recipient || recipient === zeroAddress) {
          return "Enter a valid recipient address";
        }
        if (address && recipient.toLowerCase() === address.toLowerCase()) {
          return "Cannot transfer to your own address";
        }
        return true;
      },
    },
  });

  const validateBalance = useCallback(
    (value: string): string | true => {
      if (isLockedAmountError) {
        return "Unable to fetch locked margin. Please try again.";
      }
      if (balanceQuery.data === undefined || availableBalance === undefined) {
        return "Unable to fetch balance. Please try again.";
      }
      const amountBigInt = parseUnits(value, paymentToken.decimals);
      if (amountBigInt > availableBalance) {
        const balanceFormatted = formatValue(availableBalance, paymentToken).valueRounded;
        return `Insufficient balance. Available: ${Number(balanceFormatted).toFixed(2)} ${paymentToken.symbol}`;
      }
      return true;
    },
    [balanceQuery.data, availableBalance, isLockedAmountError],
  );

  const handleMaxClick = useCallback(() => {
    if (availableBalance !== undefined) {
      const numValue = Number(availableBalance) / PAYMENT_TOKEN_SCALE_NUM;
      const floored = Math.floor(numValue * 100) / 100;
      form.setValue("amount", floored.toFixed(2));
    }
  }, [availableBalance, form]);

  const inputForm = useCallback(
    () => (
      <div className="space-y-4">
        <InputWrapper>
          <TextField
            {...recipientController.field}
            label="Recipient Address"
            fullWidth
            error={!!recipientController.fieldState.error}
            helperText={recipientController.fieldState.error?.message}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
          />
        </InputWrapper>
        <AmountInputForm
          control={form.control as Control<{ amount: string }>}
          label="Transfer Amount"
          additionalValidate={validateBalance}
          onMaxClick={handleMaxClick}
          showMaxButton={availableBalance !== undefined && !isLoadingLockedAmount}
        />
        <p className="text-gray-400 text-sm leading-snug">
          Credits the recipient&apos;s collateral — not their wallet.
        </p>
        <div className="p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-300">Total balance:</span>
            <span className="text-white font-medium">
              {Number(balanceQuery.data ? formatValue(balanceQuery.data, paymentToken).value : "0").toFixed(2)}{" "}
              {paymentToken.symbol}
            </span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-300 inline-flex items-center gap-1">
              Locked:
              {lockedTooltip && (
                <Tooltip title={lockedTooltip} arrow placement="top">
                  <HelpOutlineIcon
                    style={{
                      fontSize: "0.95rem",
                      color: tokens.text.secondary,
                      cursor: "help",
                      verticalAlign: "middle",
                    }}
                    aria-label="About locked amount"
                  />
                </Tooltip>
              )}
            </span>
            <span className="text-white font-medium">
              {isLoadingLockedAmount
                ? "..."
                : isLockedAmountError
                  ? "—"
                  : `${Number(formatValue(lockedDisplayAmount, paymentToken).value).toFixed(2)} ${paymentToken.symbol}`}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-300">Available to transfer:</span>
            <span className="text-white font-medium">
              {isLoadingLockedAmount || isLockedAmountError
                ? isLockedAmountError
                  ? "—"
                  : "..."
                : availableBalance !== undefined
                  ? `${(Math.floor((Number(availableBalance) / PAYMENT_TOKEN_SCALE_NUM) * 100) / 100).toFixed(2)}`
                  : "0"}{" "}
              {paymentToken.symbol}
            </span>
          </div>
        </div>
      </div>
    ),
    [
      recipientController.field,
      recipientController.fieldState.error,
      form.control,
      validateBalance,
      handleMaxClick,
      availableBalance,
      balanceQuery.data,
      lockedDisplayAmount,
      isLoadingLockedAmount,
      isLockedAmountError,
      lockedTooltip,
    ],
  );

  const validateInput = useCallback(async () => {
    const amountValue = form.getValues("amount");
    const recipientValue = form.getValues("recipient");
    let valid = true;

    const recipient = normalizeRecipient(recipientValue);
    if (!recipient || recipient === zeroAddress) {
      form.setError("recipient", {
        type: "validation",
        message: "Enter a valid recipient address",
      });
      valid = false;
    } else if (address && recipient.toLowerCase() === address.toLowerCase()) {
      form.setError("recipient", {
        type: "validation",
        message: "Cannot transfer to your own address",
      });
      valid = false;
    }

    if (!amountValue || parseFloat(amountValue) <= 0) {
      form.setError("amount", {
        type: "validation",
        message: "Transfer Amount must be a positive number",
      });
      valid = false;
    } else if (isLockedAmountError) {
      form.setError("amount", {
        type: "validation",
        message: "Unable to fetch locked margin. Please try again.",
      });
      valid = false;
    } else if (balanceQuery.data === undefined || availableBalance === undefined) {
      form.setError("amount", {
        type: "validation",
        message: "Unable to fetch balance. Please try again.",
      });
      valid = false;
    } else {
      const amountBigInt = parseUnits(amountValue, paymentToken.decimals);
      if (amountBigInt > availableBalance) {
        const balanceFormatted = formatValue(availableBalance, paymentToken).valueRounded;
        form.setError("amount", {
          type: "validation",
          message: `Insufficient balance. Available: ${balanceFormatted} ${paymentToken.symbol}`,
        });
        valid = false;
      }
    }

    return valid;
  }, [form, address, balanceQuery.data, availableBalance, isLockedAmountError]);

  const transactionSteps: TransactionStep[] = [
    {
      label: "Withdraw Collateral",
      async action() {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        const result = await removeMarginAsync({ amount: amountBigInt });
        return { isSkipped: false, txhash: result };
      },
    },
    {
      label: "Authorize",
      async action(txState: Record<number, TxState>) {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        if (!spenderAddress) {
          throw new Error("Collateral vault address not loaded yet. Please try again.");
        }
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        const minBlockNumber = txState[0]?.blockNumber;

        if (isPermitSupported) {
          const permit = await signPermit(amountBigInt);
          if (!permit) throw new Error("Wallet not ready. Please try again.");
          return { isSkipped: false, isOffChain: true, state: { mode: "permit", ...permit } };
        }

        const result = await approveAsync({
          spender: spenderAddress,
          amount: amountBigInt,
          minBlockNumber,
        });
        return result
          ? { isSkipped: false, txhash: result, state: { mode: "approve" } }
          : { isSkipped: true, state: { mode: "approve" } };
      },
    },
    {
      label: "Deposit to Recipient",
      async action(txState: Record<number, TxState>) {
        const amount = form.getValues("amount");
        const recipient = normalizeRecipient(form.getValues("recipient"));
        if (!amount) throw new Error("Amount not set");
        if (!recipient) throw new Error("Recipient not set");
        const amountBigInt = parseUnits(amount, paymentToken.decimals);

        const authorized = txState[1]?.customState as AuthorizeState | undefined;
        // Prefer the authorize step's block when it was on-chain; otherwise the
        // withdraw block (permit is off-chain and USDC arrived at withdraw).
        const minBlockNumber = txState[1]?.blockNumber ?? txState[0]?.blockNumber;

        if (authorized?.mode === "permit") {
          const result = await addMarginWithPermitAsync({
            amount: amountBigInt,
            deadline: authorized.deadline,
            signature: authorized.signature,
            recipient,
            minBlockNumber,
          });
          return { isSkipped: false, txhash: result };
        }

        const result = await depositForAsync({
          recipient,
          amount: amountBigInt,
          minBlockNumber,
        });
        return { isSkipped: false, txhash: result };
      },
    },
  ];

  return (
    <TransactionForm
      onClose={closeForm}
      title="Internal Transfer"
      description="Move available collateral to another account's vault balance"
      reviewForm={inputForm}
      validateInput={validateInput}
      transactionSteps={transactionSteps}
      resultForm={() => (
        <div className="space-y-4">
          <div className="p-4 rounded-lg">
            <p className="text-gray-300">Collateral transferred to the recipient&apos;s vault balance.</p>
            <p className="text-white font-medium mt-2">
              Amount: {form.getValues("amount")} {paymentToken.symbol}
            </p>
            <p className="text-white font-medium mt-1 break-all">
              Recipient: {normalizeRecipient(form.getValues("recipient")) ?? form.getValues("recipient")}
            </p>
          </div>
        </div>
      )}
    />
  );
};
