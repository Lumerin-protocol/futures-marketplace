import { type FC, useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import type { AccountBalance } from "../../types/types";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import { AmountInputForm } from "./Shared/AmountInputForm";
import { formatValue, paymentToken } from "../../lib/units";
import { parseUnits } from "viem";
import {
  usePermitPerps,
  usePerpsAddCollateralWithPermit,
} from "../../hooks/data/perps/usePerpsAddCollateralPermit";
import type { PermitSignature } from "../../hooks/data/perps/usePermit";
import { TxState } from "../../hooks/useTxForm";

interface DepositFormProps {
  closeForm: () => void;
  accountBalance?: AccountBalance;
}

interface InputValues {
  amount: string;
}

export const DepositFormPerps: FC<DepositFormProps> = ({ closeForm, accountBalance }) => {
  const { signPermit } = usePermitPerps();
  const { addCollateralAsync } = usePerpsAddCollateralWithPermit();
  const [signature, setSignature] = useState<
    { signature: PermitSignature; deadline: bigint } | undefined
  >();

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
      const numValue = Number(paymentTokenBalance.data) / 1e6; // Convert from wei to USDC
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
    if (!amountValue || Number.parseFloat(amountValue) <= 0) {
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
                          const numValue = Number(paymentTokenBalance.data) / 1e6; // Convert from wei to USDC
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
    [paymentTokenBalance.data, paymentTokenBalance.isLoading],
  );

  const transactionSteps = [
    {
      label: "Approve Token",
      async action() {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        if (!signPermit) throw new Error("Permit not ready. Please wait for wallet to connect and try again.");
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        const result = await signPermit({
          value: amountBigInt,
        });
        setSignature(result);
        return { isSkipped: false, state: result };
      },
    },
    {
      label: "Deposit Collateral",
      async action(steps: Record<number, TxState>) {
        const amount = form.getValues("amount");
        if (!amount) throw new Error("Amount not set");
        const amountBigInt = parseUnits(amount, paymentToken.decimals);
        console.log("steps", steps);
        const sig = steps[0].customState as { signature: PermitSignature; deadline: bigint };
        const result = await addCollateralAsync({
          amount: amountBigInt,
          deadline: sig.deadline,
          signature: sig.signature,
        });
        return result ? { isSkipped: false, txhash: result } : { isSkipped: false };
      },
    },
  ];

  return (
    <TransactionForm
      onClose={closeForm}
      title={"Deposit Collateral"}
      description={"Add collateral to your perpetual account"}
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
