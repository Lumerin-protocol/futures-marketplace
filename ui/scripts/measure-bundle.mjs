import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { TraceMap, eachMapping } from "@jridgewell/trace-mapping";
import { add, bucketOf, isStylingPackage, kb, packageOf, walkFiles } from "./lib/measure-utils.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const SRC = join(ROOT, "src");

function gzipSize(buf) {
  return gzipSync(buf).length;
}

function attributeFile(jsPath) {
  const code = readFileSync(jsPath, "utf8");
  const mapPath = `${jsPath}.map`;
  const sizes = new Map();
  let mapped = false;
  try {
    const tracer = new TraceMap(JSON.parse(readFileSync(mapPath, "utf8")));
    const lines = code.split("\n");
    const byLine = [];
    eachMapping(tracer, (m) => {
      const i = m.generatedLine - 1;
      (byLine[i] ??= []).push(m);
    });
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const newline = i < lines.length - 1 ? 1 : 0;
      const mappings = byLine[i];
      if (!mappings?.length) {
        add(sizes, "(unmapped)", line.length + newline);
        continue;
      }
      mappings.sort((a, b) => a.generatedColumn - b.generatedColumn);
      if (mappings[0].generatedColumn > 0) {
        add(sizes, "(unmapped)", mappings[0].generatedColumn);
      }
      for (let j = 0; j < mappings.length; j++) {
        const start = mappings[j].generatedColumn;
        const next = j + 1 < mappings.length ? mappings[j + 1].generatedColumn : line.length;
        add(sizes, packageOf(mappings[j].source), Math.max(0, next - start));
      }
      if (newline) add(sizes, packageOf(mappings[mappings.length - 1].source), 1);
    }
    mapped = true;
  } catch {
    add(sizes, "(unmapped)", Buffer.byteLength(code));
  }
  return { sizes, mapped, raw: Buffer.byteLength(code), gzip: gzipSize(code) };
}

function staticImports(code) {
  const out = [];
  const re = /(?:^|[\n;{}])\s*import\s*(?:type\s+)?(?:[^'"\n]*?\s*from\s*)?["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}

function dynamicImports(code) {
  const out = [];
  const re = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const abs = resolve(dirname(fromFile), spec);
  return abs.endsWith(".js") || abs.endsWith(".css") ? abs : `${abs}.js`;
}

function collectGraph(entryFiles, { followDynamic }) {
  const seen = new Set();
  const queue = [...entryFiles];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    try {
      statSync(file);
    } catch {
      continue;
    }
    seen.add(file);
    if (!file.endsWith(".js")) continue;
    const code = readFileSync(file, "utf8");
    for (const spec of staticImports(code)) {
      const next = resolveImport(file, spec);
      if (next) queue.push(next);
    }
    if (followDynamic) {
      for (const spec of dynamicImports(code)) {
        const next = resolveImport(file, spec);
        if (next) queue.push(next);
      }
    }
  }
  return seen;
}

function gitShort() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function depVersion(pkg) {
  try {
    const json = JSON.parse(readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf8"));
    return json.version;
  } catch {
    return null;
  }
}

export function measureBundle() {
  const srcFiles = walkFiles(SRC, (_p, name) => /\.(tsx?)$/.test(name));
  const inventory = {
    tsFiles: srcFiles.length,
    styledHtml: 0,
    styledComponent: 0,
    sx: 0,
    muiStyledImportFiles: 0,
    emotionReactImportFiles: 0,
    yakImportFiles: 0,
    muiWidgetImports: new Map(),
  };
  for (const f of srcFiles) {
    const text = readFileSync(f, "utf8");
    inventory.styledHtml += [...text.matchAll(/styled\(\s*["'][A-Za-z0-9]+["']/g)].length;
    inventory.styledComponent += [...text.matchAll(/styled\(\s*[A-Z][A-Za-z0-9.]*/g)].length;
    inventory.sx += [...text.matchAll(/\bsx=\{/g)].length;
    if (text.includes("@mui/material/styles/styled")) inventory.muiStyledImportFiles += 1;
    if (text.includes("@emotion/react")) inventory.emotionReactImportFiles += 1;
    if (/from\s+["']next-yak["']/.test(text)) inventory.yakImportFiles += 1;
    const local = new Set();
    const re = /from\s+["']@mui\/material(?:\/([A-Za-z0-9]+))?["']/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      if (!name || name === "styles") continue;
      local.add(name);
    }
    for (const name of local) add(inventory.muiWidgetImports, name, 1);
  }
  inventory.muiWidgetImports = Object.fromEntries(
    [...inventory.muiWidgetImports.entries()].sort((a, b) => b[1] - a[1]),
  );

  const assets = walkFiles(join(BUILD, "assets"), (_p, name) => {
    const e = extname(name);
    return e === ".js" || e === ".css";
  });

  const perFile = [];
  const pkgRaw = new Map();
  const bucketRaw = new Map();
  let totalRaw = 0;
  let totalGzip = 0;
  let cssRaw = 0;
  let cssGzip = 0;
  let jsRaw = 0;
  let jsGzip = 0;

  for (const file of assets) {
    const buf = readFileSync(file);
    const raw = buf.length;
    const gzip = gzipSize(buf);
    totalRaw += raw;
    totalGzip += gzip;
    const rel = relative(BUILD, file);
    if (file.endsWith(".css")) {
      cssRaw += raw;
      cssGzip += gzip;
      perFile.push({ rel, raw, gzip, kind: "css" });
      continue;
    }
    jsRaw += raw;
    jsGzip += gzip;
    const attr = attributeFile(file);
    const pkgs = {};
    for (const [pkg, n] of attr.sizes) {
      pkgs[pkg] = n;
      add(pkgRaw, pkg, n);
      add(bucketRaw, bucketOf(pkg), n);
    }
    perFile.push({ rel, raw, gzip, kind: "js", mapped: attr.mapped, pkgs });
  }

  function topMap(map, n = 30) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, raw]) => ({
        name,
        raw,
        kb: kb(raw),
        sharePct: jsRaw ? Math.round((raw / jsRaw) * 1000) / 10 : 0,
      }));
  }

  const html = readFileSync(join(BUILD, "index.html"), "utf8");
  const entryMatch = html.match(/src="([^"]+entry\/[^"]+\.js)"/) ?? html.match(/src="([^"]+\.js)"/);
  const cssMatch = html.match(/href="([^"]+\.css)"/);
  const entry = entryMatch ? join(BUILD, entryMatch[1].replace(/^\//, "")) : null;
  const css = cssMatch ? join(BUILD, cssMatch[1].replace(/^\//, "")) : null;
  const shellFiles = collectGraph([entry, css].filter(Boolean), { followDynamic: false });
  const fullFiles = collectGraph([entry, css].filter(Boolean), { followDynamic: true });

  function graphStats(files) {
    let raw = 0;
    let gzip = 0;
    const buckets = new Map();
    for (const f of files) {
      const info = perFile.find((p) => join(BUILD, p.rel) === f);
      if (!info) {
        const buf = readFileSync(f);
        raw += buf.length;
        gzip += gzipSize(buf);
        continue;
      }
      raw += info.raw;
      gzip += info.gzip;
      if (info.kind === "css") {
        add(buckets, "css", info.raw);
        continue;
      }
      for (const [pkg, n] of Object.entries(info.pkgs ?? {})) add(buckets, bucketOf(pkg), n);
    }
    return {
      files: files.size,
      raw,
      gzip,
      kbRaw: kb(raw),
      kbGzip: kb(gzip),
      buckets: Object.fromEntries([...buckets.entries()].map(([k, v]) => [k, { raw: v, kb: kb(v) }])),
    };
  }

  const stylingPkgs = [...pkgRaw.entries()]
    .filter(([n]) => isStylingPackage(n))
    .sort((a, b) => b[1] - a[1])
    .map(([name, raw]) => ({ name, raw, kb: kb(raw) }));
  const stylingRaw = stylingPkgs.reduce((s, p) => s + p.raw, 0);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  return {
    git: gitShort(),
    measuredAt: new Date().toISOString(),
    vite: depVersion("vite"),
    react: depVersion("react"),
    mui: depVersion("@mui/material"),
    emotionReact: depVersion("@emotion/react"),
    nextYak: depVersion("next-yak"),
    declared: {
      react: pkg.dependencies?.react,
      vite: pkg.devDependencies?.vite,
      mui: pkg.dependencies?.["@mui/material"],
      emotion: pkg.dependencies?.["@emotion/react"],
      nextYak: pkg.dependencies?.["next-yak"],
    },
    inventory: {
      ...inventory,
      styledTotal: inventory.styledHtml + inventory.styledComponent,
    },
    totals: {
      assets: assets.length,
      raw: totalRaw,
      gzip: totalGzip,
      kbRaw: kb(totalRaw),
      kbGzip: kb(totalGzip),
      jsRaw,
      jsGzip,
      jsKbRaw: kb(jsRaw),
      jsKbGzip: kb(jsGzip),
      cssRaw,
      cssGzip,
      cssKbRaw: kb(cssRaw),
      cssKbGzip: kb(cssGzip),
    },
    buckets: Object.fromEntries(
      [...bucketRaw.entries()].map(([k, v]) => [
        k,
        { raw: v, kb: kb(v), sharePct: jsRaw ? Math.round((v / jsRaw) * 1000) / 10 : 0 },
      ]),
    ),
    styling: {
      raw: stylingRaw,
      kb: kb(stylingRaw),
      sharePct: jsRaw ? Math.round((stylingRaw / jsRaw) * 1000) / 10 : 0,
      packages: stylingPkgs,
    },
    topPackages: topMap(pkgRaw, 30),
    graphs: {
      shellStatic: graphStats(shellFiles),
      allReachableFromEntry: graphStats(fullFiles),
    },
    largestChunks: perFile
      .slice()
      .sort((a, b) => b.gzip - a.gzip)
      .slice(0, 12)
      .map(({ rel, raw, gzip, kind }) => ({
        rel,
        kind,
        kbRaw: kb(raw),
        kbGzip: kb(gzip),
      })),
  };
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  console.log(JSON.stringify(measureBundle(), null, 2));
}
