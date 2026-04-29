# Seed data

Bundled JSON snapshots used to backfill chart history when the subgraph hasn't
indexed enough data yet. Lazy-loaded by:

- `ui/src/hooks/data/useBtcPriceIndexData.ts`
- `ui/src/hooks/data/useHashRateIndexData.ts`

## Files

| File                            | Shape per item                       |
| ------------------------------- | ------------------------------------ |
| `btcUsds.json`                  | `{ id, price, timestamp }`           |
| `btcUsdCandles-hour.json`       | `{ id, sum, count, timestamp }`     |
| `btcUsdCandles-day.json`        | `{ id, sum, count, timestamp }`     |
| `hashpriceUsds.json`            | `{ id, price, timestamp }`           |
| `hashpriceUsdCandles-hour.json` | `{ id, sum, count, timestamp }`     |
| `hashpriceUsdCandles-day.json`  | `{ id, sum, count, timestamp }`     |

`timestamp` is in **microseconds**. `price`/`sum` are scaled by `1e8`.
The average price for a candle is `sum / count`.

## Keeping bundle size small

Whenever you regenerate or update these files (e.g. by re-exporting from the
subgraph), apply these two passes so the chunks stay lean. Run from the repo
root and requires `jq`.

### 1. Drop unused fields from candle files

The candle endpoints return `high` and `low` from the subgraph, but the UI only
uses `sum`/`count` to compute an average. Strip the unused fields:

```bash
cd ui/src/seed
for f in btcUsdCandles-day.json btcUsdCandles-hour.json \
         hashpriceUsdCandles-day.json hashpriceUsdCandles-hour.json; do
  jq -c 'map({id, sum, count, timestamp})' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
```

### 2. Minify all seed JSON (remove pretty-print whitespace)

`import("./*.json")` parses the JSON, so formatting whitespace is pure overhead
in the shipped bundle.

```bash
cd ui/src/seed
for f in *.json; do
  jq -c . "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
```

### 3. Delete unused snapshots

Only files imported from the two hooks above need to live here. Before adding a
new snapshot, search the `ui/` tree to confirm there's a consumer; before
keeping an existing one, do the same. As of this writing, the only consumers
are the six files listed in the table above — anything else can be removed.

```bash
# Sanity check: every seed file should appear in a hook import.
rg -n "seed/" ui/src
```

## Verification

After running the steps above, the app should still render the BTC price and
hashprice charts identically. The seed is merged with live subgraph data via
`mergeById` and filtered by timestamp range, so removing unused fields or
whitespace cannot affect the output.
