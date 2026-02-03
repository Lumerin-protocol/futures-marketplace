import { runMarketMaker, type MarketMakerResult } from "./job.ts";
import { getConfig, toRuntimeConfig, type RuntimeConfig } from "./config.ts";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Cache for secrets (Lambda cold start optimization)
let cachedSecrets: {
  private_key?: string;
  eth_node_url?: string;
  futures_subgraph_url?: string;
  oracles_subgraph_url?: string;
} | null = null;

// Cache for runtime config
let cachedRuntimeConfig: RuntimeConfig | null = null;

/**
 * Fetch secrets from AWS Secrets Manager
 */
async function getSecrets(secretsArn: string): Promise<typeof cachedSecrets> {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretsArn })
  );

  if (!response.SecretString) {
    throw new Error("Secret value is empty");
  }

  cachedSecrets = JSON.parse(response.SecretString);
  return cachedSecrets;
}

/**
 * Get runtime config (with secrets)
 */
async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }

  const config = getConfig();

  // If SECRETS_ARN is provided, fetch secrets from Secrets Manager
  if (config.SECRETS_ARN) {
    const secrets = await getSecrets(config.SECRETS_ARN);
    cachedRuntimeConfig = toRuntimeConfig(config, secrets ?? undefined);
  } else {
    // Use environment variables directly (for local development)
    cachedRuntimeConfig = toRuntimeConfig(config);
  }

  return cachedRuntimeConfig;
}

/**
 * Lambda handler for AWS Lambda invocation
 */
export async function handler(event: unknown): Promise<{
  statusCode: number;
  body: string;
}> {
  console.log("Market Maker Lambda invoked", { event });

  try {
    const config = await getRuntimeConfig();
    const result = await runMarketMaker(config);

    // Log result
    console.log("Market Maker completed", result);

    // Return appropriate status code
    if (result.success) {
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    } else if (result.insufficientFunds) {
      // Insufficient funds is a "soft" failure - don't trigger error alarms
      // Return 200 but with warning in the body
      return {
        statusCode: 200,
        body: JSON.stringify({
          ...result,
          warning: "Insufficient funds - market maker paused until funds are replenished",
        }),
      };
    } else {
      // Other failures
      return {
        statusCode: 500,
        body: JSON.stringify(result),
      };
    }
  } catch (error) {
    console.error("Market Maker failed", error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: errorMessage,
        ordersPlaced: 0,
      } as MarketMakerResult),
    };
  }
}

/**
 * Main entry point for local development / ECS (backwards compatibility)
 * Runs the market maker once and exits
 */
export async function main(): Promise<void> {
  try {
    const config = await getRuntimeConfig();
    const result = await runMarketMaker(config);
    
    console.log("Market Maker completed", result);
    
    if (!result.success && !result.insufficientFunds) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Market Maker failed", error);
    process.exit(1);
  }
}

// If running directly (not as Lambda), execute main
// Check if this is being imported as a module or run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
