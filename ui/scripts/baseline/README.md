# Styling / toolchain baselines

JSON snapshots live next to this file. Re-run with:

```bash
pnpm measure:baseline -- --build --out <label>
```

That production-builds, profiles `/trade/futures` at 1440×900 via Playwright, and writes `scripts/baseline/<label>.json`.

| Snapshot | Stack |
| --- | --- |
| `emotion-before.json` | Vite 6.4.3, React 18.3.1, Node 22 engines, Emotion + MUI |
| `vite8-react19.json` | Vite 8.3.0 (Rolldown), React 19.3.0, Node ≥24, same Emotion + MUI |

Runtime numbers are one cold localhost load. Treat milliseconds as directional. Bundle gzip is from the production `build/` sourcemaps.

## Vite 8 / React 19 vs Emotion-on-Vite-6

Same app, same CSS-in-JS. The delta is the toolchain.

| | Emotion / Vite 6 / React 18 | Vite 8 / React 19 | Change |
| --- | --- | --- | --- |
| Production build | ~9.5 s | ~2 s | ~4× faster (Rolldown) |
| All JS gzip | 2206 KB | 1752 KB | **−21%** |
| JS raw | 8059 KB | 6439 KB | −20% |
| Entry chunk gzip | 143 KB | 96 KB | −33% |
| First-load shell gzip | 146 KB | 169 KB | +15% (React 19 is larger in the shell) |
| FCP | 232 ms | 184 ms | −21% |
| Script time | 222 ms | 165 ms | −26% |
| Task time | 430 ms | 301 ms | −30% |
| Style recalc | 19 ms | 9 ms | −53% |
| Emotion `insertRule`s | 428 | 423 | unchanged |
| Emotion serialize / stylis | 19 ms | 18 ms | unchanged |

React 19 itself is heavier in the first-load graph (React bucket 139 KB → 214 KB raw). Net download still fell because Oxc minification and Rolldown chunking shrank vendor.

Emotion’s runtime CSS tax did not move: still ~400 CSSOM inserts and ~18 ms of serialize/stylis. That is the delta a compile-time CSS compiler (next-yak) is supposed to remove.

## After yak

```bash
pnpm measure:baseline -- --build --out yak-after
```

Compare `emotionRuleCount`, `insertRule.count`, `cpu.cssCompileMs`, and `totals.cssKbGzip` against `vite8-react19.json` (not against `emotion-before.json`, or you mix toolchain and CSS-in-JS).
