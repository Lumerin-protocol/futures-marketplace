import { run } from "hardhat";

const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_RETRY_DELAY_MS = 10_000;

export async function verifyContract(address: string, constructorArgs?: any[]) {
  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    try {
      await run("verify:verify", {
        address,
        constructorArguments: constructorArgs,
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // If already verified, treat as success.
      if (/already verified/i.test(message)) {
        console.log(`Contract ${address} is already verified.`);
        return;
      }

      if (attempt < VERIFY_MAX_ATTEMPTS) {
        console.warn(
          `Verification attempt ${attempt}/${VERIFY_MAX_ATTEMPTS} failed for ${address}: ${message}`
        );
        console.warn(`Retrying in ${VERIFY_RETRY_DELAY_MS / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_DELAY_MS));
        continue;
      }

      console.error(
        `Verification failed for ${address} after ${VERIFY_MAX_ATTEMPTS} attempts. Continuing script.`
      );
      console.error(err);
    }
  }
}
