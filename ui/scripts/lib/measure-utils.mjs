import { readdirSync } from "node:fs";
import { join } from "node:path";

export function walkFiles(dir, pred, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, pred, acc);
    else if (pred(p, ent.name)) acc.push(p);
  }
  return acc;
}

export function kb(n) {
  return Math.round((n / 1024) * 10) / 10;
}

export function ms(us) {
  return Math.round((us / 1000) * 10) / 10;
}

export function add(map, key, n) {
  map.set(key, (map.get(key) ?? 0) + n);
}

export function packageOf(source) {
  if (!source) return "(unmapped)";
  const norm = source.replaceAll("\\", "/");
  const nm = norm.lastIndexOf("/node_modules/");
  if (nm >= 0) {
    const rest = norm.slice(nm + "/node_modules/".length);
    if (rest.startsWith("@")) {
      const parts = rest.split("/");
      return `${parts[0]}/${parts[1]}`;
    }
    return rest.split("/")[0];
  }
  if (norm.includes("/src/") || /(^|\/)src\//.test(norm)) return "app";
  if (norm.includes("/css-") || norm.endsWith(".css") || norm.includes("index.css") || norm.includes("fonts.css")) {
    return "app-css";
  }
  return "(other)";
}

export function bucketOf(pkg) {
  if (pkg.startsWith("@emotion/") || pkg === "stylis") return "emotion";
  if (pkg === "next-yak" || pkg.startsWith("@yak-")) return "yak";
  if (pkg.startsWith("@mui/")) return "mui";
  if (pkg === "app" || pkg === "app-css") return "app";
  if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") return "react";
  if (pkg === "(unmapped)" || pkg === "(other)") return pkg;
  return "vendor";
}

/** JS a build-time CSS compiler is meant to remove. */
export function cssRuntimeKind(pkg) {
  if (pkg.startsWith("@emotion/") || pkg === "stylis" || pkg === "hoist-non-react-statics") {
    return "emotion";
  }
  if (pkg === "@mui/styled-engine" || pkg === "@mui/system" || pkg === "@mui/styled-engine-sc") {
    return "mui-styled";
  }
  if (pkg === "next-yak" || pkg.startsWith("@yak-")) return "yak";
  return null;
}

export function isStylingPackage(name) {
  return (
    name.startsWith("@emotion/") ||
    name.startsWith("@mui/") ||
    name === "@popperjs/core" ||
    name === "stylis" ||
    name === "next-yak" ||
    name.startsWith("@yak-")
  );
}
