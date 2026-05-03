import { type FC, useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { useAccount } from "wagmi";
import { useAddMargin, useApproveAddMargin } from "../../hooks/data/useAddMargin";
import { usePerpsAddCollateral, useApprovePerpsAddCollateral } from "../../hooks/data/perps/usePerpsAddCollateral";
import { useApproveERC20 } from "../../hooks/data/useApproveERC20";
import { useFuturesCollateralVault } from "../../hooks/data/useFuturesCollateralVault";
import type { AccountBalance, ContractMode } from "../../types/types";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import { AmountInputForm } from "./Shared/AmountInputForm";
import { formatValue, PAYMENT_TOKEN_SCALE_NUM, paymentToken } from "../../lib/units";
import { parseUnits } from "viem";

interface DepositFormProps {
  closeForm: () => void;
  accountBalance?: AccountBalance;
  contractMode?: ContractMode;
}

interface InputValues {
  amount: string;
}

export const DepositForm: FC<DepositFormProps> = ({ closeForm, accountBalance, contractMode = "futures" }) => {
  const { address } = useAccount();
  
  // Conditionally use futures or perps hooks based on mode
  const { addMarginAsync } = useAddMargin();
  const { approveAsync: futuresApproveAsync } = useApproveAddMargin();
  const { addCollateralAsync } = usePerpsAddCollateral();
  const { approveAsync: perpsApproveAsync } = useApprovePerpsAddCollateral();
  
  const approveAsync = contractMode === "perpetual" ? perpsApproveAsync : futuresApproveAsync;
  const depositAsync = contractMode === "perpetual" ? addCollateralAsync : addMarginAsync;

  // Futures `addMargin` proxies to `collateralVault.depositFor`, which pulls the underlying token
  // from the caller into the vault — so for futures mode the ERC20 spender must be the vault, not
  // the Futures contract. Perps still pulls directly into the perps engine.
  const { data: futuresVaultAddress } = useFuturesCollateralVault();
  const spenderAddress = contractMode === "perpetual"
    ? (process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`)
    : (futuresVaultAddress as `0x${string}` | undefined);

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
      const numValue = Number(paymentTokenBalance.data) / PAYMENT_TOKEN_SCALE_NUM; // Convert from wei to USDC
      const floored = Math.floor(numValue * 100) / 100; // Round down to 2 decimals
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

    // Check if balance is available
    if (!paymentTokenBalance.data) {
      form.setError("amount", {
        type: "validation",
        message: "Unable to fetch balance. Please try again.",
      });
      return false;
    }

    // Validate that amount doesn't exceed balance
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
                          const numValue = Number(paymentTokenBalance.data) / PAYMENT_TOKEN_SCALE_NUM; // Convert from wei to USDC
                          const floored = Math.floor(numValue * 100) / 100; // Round down to 2 decimals
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
    [paymentTokenBalance.data],
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
      async action() {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        const result = await depositAsync({ amount: amountBigInt });
        return result ? { isSkipped: false, txhash: result } : { isSkipped: false };
      },
    },
  ];

  const title = "Deposit Collateral";
  const description = contractMode === "perpetual"
    ? "Add collateral to your perpetual account"
    : "Add collateral to your futures account";

  return (
    <TransactionForm
      onClose={closeForm}
      title={title}
      description={description}
      reviewForm={reviewForm}
      validateInput={validateInput}
      transactionSteps={transactionSteps}
      resultForm={(p) => (
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
