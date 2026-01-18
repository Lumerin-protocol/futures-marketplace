# Margin Call Lambda

A lightweight Lambda-friendly worker that monitors **Futures** market participants, sends margin utilization alerts, and (optionally) triggers on-chain `marginCall` executions. It pulls participants from the marketplace subgraph, enriches each wallet with on-chain balances, and notifies the Notifications service when utilization crosses a configurable threshold.

## How It Works

- Fetch all futures participants from the configured subgraph (`gateway/subgraph.ts`).
- For each wallet, read `getMinMargin` and `balanceOf` from the configured `Futures` contract.
- Compute the margin utilization ratio (`minMargin / balance`).
- Send deficit alerts to the notification service whenever utilization exceeds `MARGIN_UTILIZATION_WARNING_PERCENT`.
- When the Lambda event sets `executeMarginCall = true`, batch wallets whose utilization is `>= 100%` and invoke `Futures.marginCall` for each entry via `Multicall3` (`gateway/marginCall.ts`).

## Prerequisites

- Node.js 22+
- Yarn 1.x (or compatible npm client)
- Access to:
  - An Ethereum RPC node
  - The futures subgraph endpoint plus API key (if required)
  - Notification service endpoint
  - Deployed Futures + Multicall contracts

## Environment Variables

These are validated at startup via `env-schema` (see `config/env.ts`).

## Install & Build

```bash
cd /Users/shev/Dev/titan/smart-contracts/margin-call
yarn install
yarn copy-abi      # copies ../abi/Futures.json into ./abi
yarn start         # runs main.ts via tsx

# Bundle for Lambda
yarn build         # emits dist/index.js (+ sourcemap)
```

## Local Execution

```bash
# Ensure environment variables are exported or defined in .env
yarn start

# or execute the bundled artifact
node dist/index.js
```

## AWS Lambda Usage

The bundle exports `handler(event, context)` (CommonJS). Package `dist/index.js` and deploy as your Lambda entry point.

Basic deployment flow:

```bash
yarn build
zip -j lambda.zip dist/index.js dist/index.js.map
aws lambda update-function-code \
  --function-name margin-call \
  --zip-file fileb://lambda.zip
```

## Invoking With `executeMarginCall`

`executeMarginCall` (boolean) controls whether the worker only sends alerts (`false`, default) or also executes on-chain margin calls (`true`).

### Sample AWS CLI Invocation

```bash
aws lambda invoke \
  --function-name margin-call \
  --cli-binary-format raw-in-base64-out \
  --payload '{"executeMarginCall":true}' \
  response.json

cat response.json
# {"statusCode":200,"body":"{\"message\":\"Margin call check completed successfully\"}"}
```

### Local Simulation

```bash
node -e "require('./dist/index.js').handler({ executeMarginCall: true }, {}).then(console.log)"
```

When `executeMarginCall` is `true`, any wallet whose utilization is `>= 1.0` is batched (100 per transaction) and the worker submits a Multicall transaction executing `Futures.marginCall(address)` for each entry before returning.

## Logging & Observability

- Structured logs provided by `pino`; adjust verbosity via `LOG_LEVEL`.
- On failure, the handler returns `statusCode: 500` plus the serialized error message, making it easy to spot issues in CloudWatch.
