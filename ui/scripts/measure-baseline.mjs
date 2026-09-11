/**
 * Capture a styling baseline (bundle + runtime CSS-in-JS) for before/after
 * comparison. Writes JSON to scripts/baseline/<label>.json
 *
 *   pnpm measure:baseline                 # uses existing build + preview if up
 *   pnpm measure:baseline -- --build      # production build first
 *   pnpm measure:baseline -- --out yak-after
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureBundle } from "./measure-bundle.mjs";
import { measureRuntime } from "./measure-runtime.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const ORIGIN = process.env.PREVIEW_URL ?? `http://127.0.0.1:${PORT}`;

const argv = process.argv.filter((a) => a !== "--");

function arg(flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const next = argv[i + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

async function previewUp() {
  try {
    const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

function startPreview() {
  const child = spawn("pnpm", ["preview", "--port", String(PORT), "--host", "127.0.0.1"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HUSKY: "0" },
  });
  return new Promise((resolveP, reject) => {
    const onData = (buf) => {
      const text = buf.toString();
      if (text.includes("Local:") || text.includes("http://127.0.0.1")) {
        child.stdout.off("data", onData);
        resolveP(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      reject(new Error(`preview exited ${code}`));
    });
    setTimeout(() => reject(new Error("preview did not start in 20s")), 20000);
  });
}

function runBuild() {
  return new Promise((resolveB, reject) => {
    const child = spawn("pnpm", ["build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, HUSKY: "0" },
    });
    child.on("exit", (code) => (code === 0 ? resolveB() : reject(new Error(`build exited ${code}`))));
  });
}

const doBuild = Boolean(arg("--build"));
const label = arg("--out") === true || !arg("--out") ? "latest" : String(arg("--out"));

if (doBuild) {
  console.error("building…");
  await runBuild();
}

console.error("measuring bundle…");
const bundle = measureBundle();

let preview = null;
if (!(await previewUp())) {
  console.error(`starting preview on ${ORIGIN}…`);
  preview = await startPreview();
}

console.error("measuring runtime…");
const runtime = await measureRuntime({ origin: ORIGIN });

if (preview) preview.kill("SIGTERM");

const out = {
  label,
  measuredAt: new Date().toISOString(),
  bundle,
  runtime,
};

const dir = join(ROOT, "scripts/baseline");
mkdirSync(dir, { recursive: true });
const dest = join(dir, `${label}.json`);
writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
console.error(`wrote ${dest}`);
console.log(JSON.stringify(out, null, 2));
