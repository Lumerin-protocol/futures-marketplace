import {
  BaseError,
  InvalidInputRpcError,
  ContractFunctionRevertedError,
  UnknownRpcError,
} from "viem";
import { decodeErrorResult, DecodeErrorResultReturnType } from "viem/utils";
import { Abi } from "viem";

/**
 * Check if the error is a custom solidity error from the given ABI
 * @param err - The error to check
 * @param abi - The ABI to check
 * @param error - The error name to check
 * @returns True if the error is a custom error from the given ABI, false otherwise
 */
export function isErr<const TAbi extends Abi | readonly unknown[]>(
  err: any,
  abi: TAbi | undefined,
  error: DecodeErrorResultReturnType<TAbi>["errorName"]
): boolean {
  if (err instanceof BaseError) {
    const revertError = err.walk((err) => {
      return (
        err instanceof InvalidInputRpcError ||
        err instanceof ContractFunctionRevertedError ||
        err instanceof UnknownRpcError
      );
    });

    // support for regular provider
    if (revertError instanceof ContractFunctionRevertedError) {
      const errorName = revertError.data?.errorName ?? "";
      if (errorName === error) {
        return true;
      }
    }

    // support for hardhat node
    let data: `0x${string}` = "0x";
    if (revertError instanceof InvalidInputRpcError) {
      data = (revertError?.cause as any)?.data?.data;
    } else if (revertError instanceof UnknownRpcError) {
      data = (revertError.cause as any)?.data;
    }

    if (data) {
      try {
        const decodedError = decodeErrorResult({ abi, data });
        if (decodedError.errorName === error) {
          return true;
        }
      } catch (e) {
        return false;
      }
    }
  }

  console.error(err);
  return false;
}
