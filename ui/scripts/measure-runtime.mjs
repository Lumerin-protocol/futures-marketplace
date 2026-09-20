import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { chromium } from "playwright";
import { add, cssRuntimeKind, kb, ms, packageOf } from "./lib/measure-utils.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const ORIGIN = process.env.PREVIEW_URL ?? "http://127.0.0.1:4173";
const PATH = process.env.MEASURE_PATH ?? "/trade/futures";

const mapCache = new Map();
function originalSource(url, lineNumber, columnNumber) {
  if (!url?.startsWith(ORIGIN)) return null;
  const local = join(BUILD, new URL(url).pathname.replace(/^\//, ""));
  const mapPath = `${local}.map`;
  if (!existsSync(mapPath)) return null;
  let tracer = mapCache.get(mapPath);
  if (!tracer) {
    tracer = new TraceMap(JSON.parse(readFileSync(mapPath, "utf8")));
    mapCache.set(mapPath, tracer);
  }
  const pos = originalPositionFor(tracer, {
    line: lineNumber + 1,
    column: columnNumber,
  });
  return pos.source ?? null;
}

function topEntries(map, n = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, us]) => ({ name, ms: ms(us), us }));
}

const INIT_SCRIPT = `(() => {
  const stats = {
    insertRuleCount: 0,
    insertRuleChars: 0,
    insertRuleMs: 0,
    deleteRuleCount: 0,
    createStyleTags: 0,
  };
  const origInsert = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (rule, index) {
    const t0 = performance.now();
    try {
      return origInsert.call(this, rule, index);
    } finally {
      stats.insertRuleMs += performance.now() - t0;
      stats.insertRuleCount += 1;
      stats.insertRuleChars += String(rule).length;
    }
  };
  const origDelete = CSSStyleSheet.prototype.deleteRule;
  CSSStyleSheet.prototype.deleteRule = function (index) {
    stats.deleteRuleCount += 1;
    return origDelete.call(this, index);
  };
  const origCreate = Document.prototype.createElement;
  Document.prototype.createElement = function (name, options) {
    const el = origCreate.call(this, name, options);
    if (String(name).toLowerCase() === "style") stats.createStyleTags += 1;
    return el;
  };
  window.__cssRuntimeStats = stats;
})();`;

export async function measureRuntime({ origin = ORIGIN, path = PATH } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(INIT_SCRIPT);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: 100 });

  const traceEvents = [];
  client.on("Tracing.dataCollected", ({ value }) => {
    traceEvents.push(...value);
  });
  const tracingDone = new Promise((resolveDone) => {
    client.on("Tracing.tracingComplete", resolveDone);
  });

  await client.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline",
    options: "record-as-much-as-possible",
  });
  await client.send("Profiler.start");

  const navStart = Date.now();
  await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("HPDX").waitFor({ timeout: 15000 });
  await page.getByLabel("Leaderboard").waitFor({ timeout: 15000 });
  await page.waitForTimeout(4000);
  const navMs = Date.now() - navStart;

  const profileResult = await client.send("Profiler.stop");
  await client.send("Tracing.end");
  await tracingDone;

  const cssRuntime = await page.evaluate(() => {
    const stats = window.__cssRuntimeStats ?? {};
    const emotionTags = [...document.querySelectorAll("style[data-emotion]")];
    const yakTags = [...document.querySelectorAll("style[data-yak], style[data-next-yak]")];
    const allStyles = [...document.querySelectorAll("style")];
    const rulesFrom = (el) => {
      try {
        return [...(el.sheet?.cssRules ?? [])].map((r) => r.cssText);
      } catch {
        return [];
      }
    };
    const sheets = [...document.styleSheets];
    const allRuleChars = sheets.reduce((n, sheet) => {
      try {
        return n + [...sheet.cssRules].reduce((m, r) => m + r.cssText.length, 0);
      } catch {
        return n;
      }
    }, 0);
    const staticCssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => ({
      href: l.href,
    }));
    const paints = performance.getEntriesByType("paint").map((e) => ({ name: e.name, startTime: e.startTime }));
    const nav = performance.getEntriesByType("navigation")[0];
    const emotionRules = emotionTags.flatMap(rulesFrom);
    return {
      stats,
      emotionTagCount: emotionTags.length,
      yakTagCount: yakTags.length,
      styleTagCount: allStyles.length,
      emotionTextChars: emotionTags.reduce((n, el) => n + (el.textContent?.length ?? 0), 0),
      emotionRuleCount: emotionRules.length,
      emotionRuleChars: emotionRules.reduce((n, t) => n + t.length, 0),
      allCssomChars: allRuleChars,
      staticCssLinks,
      paints,
      navigation: nav
        ? {
            domContentLoaded: nav.domContentLoadedEventEnd,
            loadEventEnd: nav.loadEventEnd,
            responseEnd: nav.responseEnd,
            domInteractive: nav.domInteractive,
          }
        : null,
    };
  });

  const perfMetrics = await client.send("Performance.getMetrics");
  const metrics = Object.fromEntries(perfMetrics.metrics.map((m) => [m.name, m.value]));
  await browser.close();

  const profile = profileResult.profile;
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfUs = new Map();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let totalSampleUs = 0;
  for (let i = 0; i < samples.length; i++) {
    const us = deltas[i] ?? 0;
    totalSampleUs += us;
    add(selfUs, samples[i], us);
  }

  const IDLE = new Set(["(idle)", "(program)", "(garbage collector)"]);
  const pkgUs = new Map();
  const kindUs = new Map();
  let cssCompileUs = 0;
  let idleUs = 0;
  for (const [id, us] of selfUs) {
    const node = nodes.get(id);
    const frame = node?.callFrame;
    const fn = frame?.functionName ?? "";
    if (!frame || IDLE.has(fn) || (!frame.url && !fn)) {
      idleUs += us;
      add(pkgUs, "(idle)", us);
      continue;
    }
    const src = originalSource(frame.url, frame.lineNumber ?? 0, frame.columnNumber ?? 0);
    const pkg = src ? packageOf(src) : frame.url ? packageOf(frame.url) : "(unknown)";
    add(pkgUs, pkg, us);
    const kind = cssRuntimeKind(pkg);
    if (kind) {
      add(kindUs, kind, us);
      cssCompileUs += us;
    }
  }
  const jsUs = Math.max(1, totalSampleUs - idleUs);

  function sumDur(names) {
    let dur = 0;
    let count = 0;
    for (const e of traceEvents) {
      if (!names.has(e.name) || typeof e.dur !== "number") continue;
      dur += e.dur;
      count += 1;
    }
    return { count, ms: ms(dur), us: dur };
  }

  return {
    url: `${origin}${path}`,
    viewport: "1440x900",
    wallClockMs: navMs,
    paints: cssRuntime.paints,
    navigation: cssRuntime.navigation,
    injectedCss: {
      emotionTagCount: cssRuntime.emotionTagCount,
      yakTagCount: cssRuntime.yakTagCount,
      styleTagCount: cssRuntime.styleTagCount,
      emotionDomTextChars: cssRuntime.emotionTextChars,
      emotionRuleCount: cssRuntime.emotionRuleCount,
      emotionRuleChars: cssRuntime.emotionRuleChars,
      emotionRuleKb: kb(cssRuntime.emotionRuleChars),
      allCssomChars: cssRuntime.allCssomChars,
      allCssomKb: kb(cssRuntime.allCssomChars),
      staticCssLinks: cssRuntime.staticCssLinks,
      note: "Emotion speedy mode inserts CSSOM rules (insertRule). Rule chars are the generated CSS a compiler would emit as a file. After yak, emotionRuleCount should drop and static CSS should grow.",
    },
    insertRule: {
      count: cssRuntime.stats.insertRuleCount,
      chars: cssRuntime.stats.insertRuleChars,
      kb: kb(cssRuntime.stats.insertRuleChars ?? 0),
      ms: Math.round((cssRuntime.stats.insertRuleMs ?? 0) * 10) / 10,
      deleteRuleCount: cssRuntime.stats.deleteRuleCount,
      createStyleTags: cssRuntime.stats.createStyleTags,
      note: "CSSOM insert time only. Serialization/stylis CPU is in cpu.cssCompileMs.",
    },
    cpu: {
      sampleIntervalUs: 100,
      wallSampledMs: ms(totalSampleUs),
      idleMs: ms(idleUs),
      jsMs: ms(jsUs),
      cssCompileMs: ms(cssCompileUs),
      cssCompileShareOfJsPct: Math.round((cssCompileUs / jsUs) * 1000) / 10,
      byKind: Object.fromEntries(
        [...kindUs.entries()].map(([k, us]) => [
          k,
          { ms: ms(us), shareOfJsPct: Math.round((us / jsUs) * 1000) / 10 },
        ]),
      ),
      topPackages: topEntries(pkgUs, 25).filter((p) => p.name !== "(idle)"),
      note: "Self-time from a 100µs CPU profile, remapped through production sourcemaps. Idle samples excluded from the JS denominator. cssCompileMs is @emotion/* + stylis + @mui/styled-engine + @mui/system (and next-yak if present).",
    },
    chromeMetrics: {
      RecalcStyleCount: metrics.RecalcStyleCount,
      RecalcStyleDurationMs: Math.round((metrics.RecalcStyleDuration ?? 0) * 1000 * 10) / 10,
      LayoutCount: metrics.LayoutCount,
      LayoutDurationMs: Math.round((metrics.LayoutDuration ?? 0) * 1000 * 10) / 10,
      ScriptDurationMs: Math.round((metrics.ScriptDuration ?? 0) * 1000 * 10) / 10,
      TaskDurationMs: Math.round((metrics.TaskDuration ?? 0) * 1000 * 10) / 10,
      JSHeapUsedSizeKb: kb(metrics.JSHeapUsedSize ?? 0),
    },
    timeline: {
      recalculateStyles: sumDur(new Set(["RecalculateStyles", "UpdateLayoutTree"])),
      layout: sumDur(new Set(["Layout"])),
      parseAuthorStyleSheet: sumDur(new Set(["ParseAuthorStyleSheet"])),
      parseHTML: sumDur(new Set(["ParseHTML"])),
      evaluateScript: sumDur(new Set(["EvaluateScript"])),
      functionCall: sumDur(new Set(["FunctionCall"])),
      v8Compile: sumDur(new Set(["v8.compile", "v8.compileModule"])),
    },
  };
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  console.log(JSON.stringify(await measureRuntime(), null, 2));
}
