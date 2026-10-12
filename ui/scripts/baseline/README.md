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
| `no-mui.json` | Vite 8.3.0, React 19.3.0, Emotion `styled` only (MUI widgets replaced) |
| `yak-after.json` | Vite 8.3.0, React 19.3.0, next-yak 9.9.0 (Emotion removed) |
| `compiler-after.json` | Tried `react({ compiler: true })` via Oxc; **turned off** (bundle tax, memo by hand later) |

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

## Dropping MUI (same Vite 8 / React 19 / Emotion)

Same toolchain as `vite8-react19.json`. Widgets (Tooltip, Modal, Select, Slider, TextField, …) are local Emotion `styled` components; `@mui/material` is gone. Compare against that snapshot, not `emotion-before.json`.

| | Vite 8 / React 19 / MUI | No MUI | Change |
| --- | --- | --- | --- |
| All JS gzip | 1752 KB | 1684 KB | **−68 KB (−4%)** |
| JS raw | 6439 KB | 6231 KB | −208 KB |
| Entry chunk gzip | 96 KB | 89 KB | −7 KB |
| First-load shell gzip | 169 KB | 129 KB | **−40 KB (−24%)** |
| Styling JS raw | 247 KB (MUI + Popper + Emotion) | 20 KB (Emotion only) | **−227 KB (−92%)** |
| MUI in the shell | 96 KB raw | 0 | gone from first paint |
| Futures chunk gzip | 192 KB | 166 KB | −26 KB |
| Emotion CSSOM rules | 407 | 270 | −34% |
| `insertRule`s | 423 | 274 | −35% |
| CSSOM insert time | 3.6 ms | 1.3 ms | −2.3 ms |
| Serialize / stylis / MUI system | 18 ms | 15 ms | −3 ms (`@mui/system` gone; Emotion still ~15 ms) |

The download win is the first-load shell: MUI used to ride along with the header. App code grew ~23 KB raw for the replacement widgets and Heroicons, which is why the all-JS gzip drop is smaller than the MUI library it replaced.

Paint / script / task times from this one localhost sample moved around (FCP 184 → 224 ms) and are not a reliable MUI delta. Heap was 23.9 MB → 21.6 MB.

Emotion is still injecting ~270 rules at runtime. That remaining ~15 ms of serialize/stylis is the yak delta.

## next-yak vs Emotion (same Vite 8 / React 19, no MUI)

Same widgets as `no-mui.json`. Compare against that snapshot, not against `vite8-react19.json`, or you mix dropping MUI with compiling CSS.

| | Emotion, no MUI | next-yak | Change |
| --- | --- | --- | --- |
| All JS gzip | 1684 KB | 1657 KB | **−27 KB** |
| JS raw | 6231 KB | 6143 KB | −88 KB |
| App JS raw | 365 KB | 299 KB | −66 KB (templates extracted) |
| Static CSS gzip | 3.4 KB | 15.9 KB | +12.5 KB (the extracted CSS) |
| First-load shell gzip | 129 KB | 115 KB | **−14 KB (−11%)** |
| Styling JS raw | 20.4 KB (Emotion) | 0.1 KB (yak runtime) | **−20 KB** |
| Futures chunk gzip | 166 KB | 152 KB JS + 9 KB CSS | styles leave the JS chunk |
| Emotion CSSOM rules | 270 | **0** | gone |
| `insertRule`s | 274 | **0** | gone |
| Serialize / stylis CPU | 15 ms (6.8% of JS) | **0 ms** | gone |
| Style recalc count | 153 | 75 | half as many invalidations |
| Heap | 21.6 MB | 20.0 MB | −1.6 MB |

The styling-attributed CPU is gone: Emotion’s serialize/stylis plus `insertRule` do not show up in the yak profile at all. Whole-page script/task/FCP from this one localhost sample did not get cheaper (script 185 → 192 ms, task 423 → 448 ms, FCP 224 → 256 ms) — that is chart/React/wallet noise, not yak adding work. Style recalc *duration* stayed ~20 ms; the count dropped because we parse stylesheets once instead of inserting 274 CSSOM rules.

```bash
pnpm measure:baseline -- --build --out yak-after
```

## React Compiler vs yak-only (same Vite 8 / React 19 / next-yak)

`react({ compiler: true })` with `oxc-transform-react` 0.149. Do not compare this to the Babel `reactCompilerPreset` path — that would bring `@babel/core` back and slow the 2 s Rolldown build. Compare against `yak-after.json`.

The compiler is on: production JS contains hundreds of `react.memo_cache_sentinel` slots (424 in the Futures chunk). React 19 already ships `react/compiler-runtime`; the React bucket did not grow.

| | next-yak | + React Compiler | Change |
| --- | --- | --- | --- |
| Production build | ~1.7 s | 1.9 s | still ~2 s |
| All JS gzip | 1657 KB | 1694 KB | **+37 KB** |
| JS raw | 6143 KB | 6233 KB | +90 KB |
| App JS raw | 299 KB | 390 KB | **+91 KB** (memo cache code) |
| First-load shell gzip | 115 KB | 117 KB | +2 KB |
| Futures chunk gzip | 152 KB | 184 KB | **+32 KB** |
| Styling JS / CSSOM | 0.1 KB / 0 rules | same | unchanged |

The download cost is real and sits in app code, mostly the Futures route. Cold-load script/task/FCP from this one localhost sample moved around (script 192 → 158 ms, task 448 → 352 ms, FCP 256 → 232 ms) and are not a reliable compiler delta — same noise as the yak vs Emotion paint numbers. The compiler's job is skipping re-renders after paint (order book, positions, query updates), which this profiler does not measure.

Turned off. Prefer memoizing the expensive islands (chart, book, form) and stopping the page from rerendering everyone on every poll, rather than paying ~32 KB gzip to auto-memo every hook.

```bash
pnpm measure:baseline -- --build --out compiler-after
```

