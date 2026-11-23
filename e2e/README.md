# HPDX end-to-end tests

Playwright suite for the trading UI in [`../ui`](../ui). Covers the critical path
from the [smoke testing manual](../docs/Smoke-Testing-Manual.md): smoke, connect,
deposit/withdraw, resting order + cancel, match + close, validation, order
management.

Standalone package (own `package.json` / lockfile). UI changes are only
`data-testid`s in [`../ui/src/testids.ts`](../ui/src/testids.ts). Open gaps and
known flake sources: [`TECH_DEBT.md`](./TECH_DEBT.md).

## What you need

- Node 24+ and pnpm 11 (`packageManager` in `package.json`).
- `ui/` dependencies installed (`cd ../ui && pnpm install`).
- Chromium for Playwright (`pnpm install:browsers` once).
- Same UI secrets you already use for local `ui` dev, in `ui/.env` or repo `.env`:
  - `REACT_APP_WALLET_CONNECT_ID`
  - `REACT_APP_READ_ONLY_ETH_NODE_URL` **or** `ALCHEMY_API_KEY`
- Optional, for funded scenarios: `e2e/.env` with a **dedicated** Base Sepolia
  test wallet (`E2E_WALLET_PRIVATE_KEY=0x…` + ~0.01 ETH gas + ~30 USDC collateral).
  Without the key, smoke / connect / validation still run; the rest skip.

```bash
cp .env.example .env   # then fill E2E_WALLET_PRIVATE_KEY if you want funded tests
```

Never put a real wallet key in `.env` — the file is gitignored but plain text.

## Run locally

Playwright starts the UI itself (`APP_ENV=dev`, port `3101`) unless you point it
at an already running server.

```bash
cd e2e
pnpm install
pnpm install:browsers   # once
pnpm test               # all specs, headless
pnpm test:smoke         # smoke + connect only (no funds needed)
```

Against your own Vite on 3001 (must be `APP_ENV=dev`):

```bash
E2E_BASE_URL=http://localhost:3001 pnpm test
```

## Headless vs UI mode

| Command | Mode |
| --- | --- |
| `pnpm test` | Headless (default). |
| `pnpm test:headed` | Visible Chromium window. |
| `pnpm test:ui` | Playwright UI mode (pick specs, time-travel). |
| `pnpm test:debug` | Inspector, step through. |

## One test, not all

```bash
pnpm test tests/30-order-resting-cancel.spec.ts
pnpm test --grep "Close all"
pnpm test:ui tests/40-order-match-close.spec.ts
```

Any Playwright flag works after `pnpm test`, e.g. `--headed`, `--debug`, `--grep`.

## Useful extras

```bash
pnpm report       # last HTML report
pnpm typecheck    # tsc --noEmit
```

Specs share one funded wallet → one worker, no parallel runs. Env vars are
documented in [`.env.example`](./.env.example).
