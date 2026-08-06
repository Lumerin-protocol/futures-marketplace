import { type FC, useCallback } from "react";
import { useForm } from "react-hook-form";
import { useAddMargin, useApproveAddMargin } from "../../hooks/data/useAddMargin";
import { useFuturesCollateralVault } from "../../hooks/data/useFuturesCollateralVault";
import type { AccountBalance } from "../../types/types";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TxState } from "../../hooks/useTxForm";
import { AmountInputForm } from "./Shared/AmountInputForm";
import { formatValue, PAYMENT_TOKEN_SCALE_NUM, paymentToken } from "../../lib/units";
import { parseUnits } from "viem";

interface DepositFormProps {
  closeForm: () => void;
  accountBalance?: AccountBalance;
}

interface InputValues {
  amount: string;
}

export const DepositForm: FC<DepositFormProps> = ({ closeForm, accountBalance }) => {
  const { addMarginAsync } = useAddMargin();
  const { approveAsync } = useApproveAddMargin();

  // Both Futures and Perps now settle against the same shared CollateralVault, so the
  // ERC20 spender is always the vault and the deposit goes through `vault.deposit(amount)`.
  const { data: vaultAddress } = useFuturesCollateralVault();
  const spenderAddress = vaultAddress as `0x${string}` | undefined;

  const paymentTokenBalance = accountBalance ?? { data: undefined, isLoading: false };

  const form = useForm<InputValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    defaultValues: {
      amount: "",
    },
  });

  const validateBalance = useCallback(
    (value: string): string | true => {
      if (!paymentTokenBalance.data) {
        return "Unable to fetch balance. Please try again.";
      }
      const amountBigInt = parseUnits(value, paymentToken.decimals);
      if (amountBigInt > paymentTokenBalance.data) {
        const balanceFormatted = formatValue(paymentTokenBalance.data, paymentToken).valueRounded;
        return `Insufficient balance. Available: ${balanceFormatted} ${paymentToken.symbol}`;
      }
      return true;
    },
    [paymentTokenBalance.data],
  );

  const handleMaxClick = useCallback(() => {
    if (paymentTokenBalance.data) {
      const numValue = Number(paymentTokenBalance.data) / PAYMENT_TOKEN_SCALE_NUM;
      const floored = Math.floor(numValue * 100) / 100;
      const maxAmount = floored.toFixed(2);
      form.setValue("amount", maxAmount);
    }
  }, [paymentTokenBalance.data, form]);

  const inputForm = useCallback(
    () => (
      <AmountInputForm
        control={form.control}
        label="Deposit Amount"
        additionalValidate={validateBalance}
        onMaxClick={handleMaxClick}
        showMaxButton={!!paymentTokenBalance.data}
      />
    ),
    [form.control, validateBalance, handleMaxClick, paymentTokenBalance.data],
  );

  const validateInput = useCallback(async () => {
    const amountValue = form.getValues("amount");
    if (!amountValue || parseFloat(amountValue) <= 0) {
      form.setError("amount", {
        type: "validation",
        message: "Deposit Amount must be a positive number",
      });
      return false;
    }

    if (!paymentTokenBalance.data) {
      form.setError("amount", {
        type: "validation",
        message: "Unable to fetch balance. Please try again.",
      });
      return false;
    }

    const amountBigInt = parseUnits(amountValue, paymentToken.decimals);
    if (amountBigInt > paymentTokenBalance.data) {
      const balanceFormatted = formatValue(paymentTokenBalance.data, paymentToken).valueRounded;
      form.setError("amount", {
        type: "validation",
        message: `Insufficient balance. Available: ${balanceFormatted} ${paymentToken.symbol}`,
      });
      return false;
    }

    return true;
  }, [form, paymentTokenBalance.data]);

  const reviewForm = useCallback(
    () => (
      <>
        {inputForm()}
        <div className="space-y-4">
          <div className="p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-gray-300">Available balance:</span>
              <span className="text-white font-medium">
                {paymentTokenBalance.isLoading ? (
                  <span>Loading...</span>
                ) : (
                  <>
                    {paymentTokenBalance.data
                      ? (() => {
                          const numValue = Number(paymentTokenBalance.data) / PAYMENT_TOKEN_SCALE_NUM;
                          const floored = Math.floor(numValue * 100) / 100;
                          return floored.toFixed(2);
                        })()
                      : "0"}{" "}
                    {paymentToken.symbol}
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </>
    ),
    [paymentTokenBalance.data, paymentTokenBalance.isLoading, inputForm],
  );

  const transactionSteps = [
    {
      label: "Approve Token",
      async action() {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        if (!spenderAddress) {
          throw new Error("Collateral vault address not loaded yet. Please try again.");
        }
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        const result = await approveAsync({
          spender: spenderAddress,
          amount: amountBigInt,
        });
        return result ? { isSkipped: false, txhash: result } : { isSkipped: true };
      },
    },
    {
      label: "Deposit Collateral",
      async action(txState: Record<number, TxState>) {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        // Pin the deposit simulation to the block the approve step confirmed
        // in (if it ran) so it doesn't race the wallet/RPC node's `latest`
        // tag before that node has caught up to the just-mined approve.
        const minBlockNumber = txState[0]?.blockNumber;
        const result = await addMarginAsync({ amount: amountBigInt, minBlockNumber });
        return result ? { isSkipped: false, txhash: result } : { isSkipped: false };
      },
    },
  ];

  return (
    <TransactionForm
      onClose={closeForm}
      title="Deposit Collateral"
      description="Add collateral to your account"
      reviewForm={reviewForm}
      validateInput={validateInput}
      transactionSteps={transactionSteps}
      resultForm={() => (
        <div className="space-y-4">
          <div className="p-4 rounded-lg">
            <p className="text-gray-300">Your deposit has been processed successfully.</p>
            <p className="text-white font-medium mt-2">
              Amount deposited: {form.getValues("amount")} {paymentToken.symbol}
            </p>
          </div>
        </div>
      )}
    />
  );
};
