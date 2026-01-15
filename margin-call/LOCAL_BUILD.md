# Local Build & Test

## Quick Start

```bash
# Install dependencies
yarn install

# Build for Lambda
yarn build

# Output: dist/index.js (bundled)
```

## Test Locally

```bash
# Set environment variables
export ETH_NODE_URL="https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY"
export SUBGRAPH_URL="https://graphidx.dev.lumerin.io/subgraphs/name/marketplace"
export SUBGRAPH_API_KEY="self-hosted"
export FUTURES_ADDRESS="0x74e3ab04fad3ba6534125f7aeae698a9cf94b4f5"
export HASHRATE_ORACLE_ADDRESS="0xdc64a140aa3e981100a9beca4e685f962f0cf6c9"
export MULTICALL_ADDRESS="0xcA11bde05977b3631167028862bE2a173976CA11"
export NOTIFICATIONS_SERVICE_URL="https://notifyint.dev.lumerin.io/notifications"
export LOG_LEVEL="debug"
export MARGIN_ALERT_THRESHOLD="0.1"

# Run built version
node dist/index.js

# Or test Lambda handler
node -e "require('./dist/index.js').handler({}, {}).then(console.log)"
```

## What Gets Built

- **Input:** `main.ts` + all imports
- **Output:** `dist/index.js` (single bundled file)
- **Size:** ~2-5MB (tree-shaken, all deps included)

