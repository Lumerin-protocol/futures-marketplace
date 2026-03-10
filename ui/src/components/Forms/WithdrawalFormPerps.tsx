import { type FC, useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import { AmountInputForm } from "./Shared/AmountInputForm";
import { formatValue, paymentToken } from "../../lib/units";
import { parseUnits } from "viem";
import { usePerpsRemoveCollateral } from "../../hooks/data/perps/usePerpsRemoveCollateral";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface WithdrawalFormPerpsProps {
  closeForm: () => void;
  minMargin: bigint | null;
  isLoadingMinMargin: boolean;
  balanceQuery: BalanceQueryResult;
}

interface InputValues {
  amount: string;
}

export const WithdrawalFormPerps: FC<WithdrawalFormPerpsProps> = ({
  closeForm,
  minMargin,
  isLoadingMinMargin,
  balanceQuery,
}) => {
  const { removeCollateralAsync } = usePerpsRemoveCollateral();

  const lockedAmount = useMemo(() => {
    return minMargin && minMargin > 0n ? minMargin : 0n;
  }, [minMargin]);

  const availableBalance = useMemo(() => {
    if (!balanceQuery.data) return undefined;
    const balance = balanceQuery.data;
    return balance > lockedAmount ? balance - lockedAmount : 0n;
  }, [balanceQuery.data, lockedAmount]);

  const form = useForm<InputValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    defaultValues: {
      amount: "",
    },
  });

  const validateBalance = useCallback(
    (value: string): string | true => {
      if (!balanceQuery.data || availableBalance === undefined) {
        return "Unable to fetch balance. Please try again.";
      }
      const amountBigInt = parseUnits(value, paymentToken.decimals);
      if (amountBigInt > availableBalance) {
        const balanceFormatted = formatValue(availableBalance, paymentToken).valueRounded;
        return `Insufficient balance. Available: ${Number(balanceFormatted).toFixed(2)} ${paymentToken.symbol}`;
      }
      return true;
    },
    [balanceQuery.data, availableBalance],
  );

  const handleMaxClick = useCallback(() => {
    if (availableBalance !== undefined) {
      const numValue = Number(availableBalance) / 1e6;
      const floored = Math.floor(numValue * 100) / 100;
      form.setValue("amount", floored.toFixed(2));
    }
  }, [availableBalance, form]);

  const inputForm = useCallback(
    () => (
      <div className="space-y-4">
        <AmountInputForm
          control={form.control}
          label="Withdrawal Amount"
          additionalValidate={validateBalance}
          onMaxClick={handleMaxClick}
          showMaxButton={availableBalance !== undefined}
        />
        <div className="p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-300">Total balance:</span>
            <span className="text-white font-medium">
              {Number(balanceQuery.data ? formatValue(balanceQuery.data, paymentToken).value : "0").toFixed(2)}{" "}
              {paymentToken.symbol}
            </span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-300">Locked amount:</span>
            <span className="text-white font-medium">
              {isLoadingMinMargin
                ? "..."
                : `${Number(formatValue(lockedAmount, paymentToken).value).toFixed(2)} ${paymentToken.symbol}`}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-300">Available balance:</span>
            <span className="text-white font-medium">
              {availableBalance !== undefined
                ? `${(Math.floor((Number(availableBalance) / 1e6) * 100) / 100).toFixed(2)}`
                : "0"}{" "}
              {paymentToken.symbol}
            </span>
          </div>
        </div>
      </div>
    ),
    [form.control, validateBalance, handleMaxClick, availableBalance, balanceQuery.data, lockedAmount, isLoadingMinMargin],
  );

  const validateInput = useCallback(async () => {
    const amountValue = form.getValues("amount");
    if (!amountValue || parseFloat(amountValue) <= 0) {
      form.setError("amount", {
        type: "validation",
        message: "Withdrawal Amount must be a positive number",
      });
      return false;
    }

    if (!balanceQuery.data || availableBalance === undefined) {
      form.setError("amount", {
        type: "validation",
        message: "Unable to fetch balance. Please try again.",
      });
      return false;
    }

    const amountBigInt = parseUnits(amountValue, paymentToken.decimals);
    if (amountBigInt > availableBalance) {
      const balanceFormatted = formatValue(availableBalance, paymentToken).valueRounded;
      form.setError("amount", {
        type: "validation",
        message: `Insufficient balance. Available: ${balanceFormatted} ${paymentToken.symbol}`,
      });
      return false;
    }

    return true;
  }, [form, balanceQuery.data, availableBalance]);

  const transactionSteps = [
    {
      label: "Withdraw Collateral",
      async action() {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        const result = await removeCollateralAsync({ amount: amountBigInt });
        return result ? { isSkipped: false, txhash: result } : { isSkipped: false };
      },
    },
  ];

  return (
    <TransactionForm
      onClose={closeForm}
      title="Withdraw Collateral"
      description="Remove collateral from your perpetual account"
      reviewForm={inputForm}
      validateInput={validateInput}
      transactionSteps={transactionSteps}
      resultForm={() => (
        <div className="space-y-4">
          <div className="p-4 rounded-lg">
            <p className="text-gray-300">Your withdrawal has been processed successfully.</p>
            <p className="text-white font-medium mt-2">
              Amount withdrawn: {form.getValues("amount")} {paymentToken.symbol}
            </p>
          </div>
        </div>
      )}
    />
  );
};
