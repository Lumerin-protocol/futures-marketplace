import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

const loadEnvFile = (
  process as typeof process & { loadEnvFile: (path: string) => void }
).loadEnvFile;

/**
 * Load env with increasing priority:
 * 1. `config/{APP_ENV}.env`
 * 2. repo-root `../.env`
 * 3. `cwd/.env`
 * 4. shell `process.env` (wins on conflict)
 *
 * `process.loadEnvFile` never overwrites a variable that is already set, so
 * files are read most-specific first. APP_ENV is taken from the shell, then
 * `.env`, then `../.env`.
 */
export function loadAppEnv(cwd = process.cwd()): Record<string, string> {
  const dir = resolve(cwd, "../config");
  const rootFile = resolve(cwd, "../.env");
  const localFile = join(cwd, ".env");
  const fileKeys = new Set<string>();
  const sources: string[] = [];

  // Highest priority files first so later loads cannot clobber them.
  tryLoad(localFile, ".env", fileKeys, sources);
  tryLoad(rootFile, "../.env", fileKeys, sources);

  const name = process.env.APP_ENV;
  if (name) {
    const configFile = join(dir, `${name}.env`);
    if (!existsSync(configFile)) {
      throw new Error(
        `[load-env] config/${name}.env not found. Available: ${availableMessage(dir)}`,
      );
    }
    tryLoad(configFile, `config/${name}.env`, fileKeys, sources);
  }

  console.log(`[load-env] APP_ENV=${name ?? "(unset)"} loaded: ${sources.join(" + ") || "(none)"}`);

  if (!name && !existsSync(rootFile) && !existsSync(localFile)) {
    throw new Error(
      `[load-env] set APP_ENV (shell or .env). Available: ${availableMessage(dir)}`,
    );
  }

  const loaded: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (
      fileKeys.has(key) ||
      key.startsWith("REACT_APP_") ||
      key === "DEV_SERVER_HTTPS" ||
      key === "ALCHEMY_API_KEY"
    ) {
      loaded[key] = value;
    }
  }
  return loaded;
}

function tryLoad(
  filePath: string,
  label: string,
  fileKeys: Set<string>,
  sources: string[],
): void {
  if (!existsSync(filePath)) {
    return;
  }
  for (const key of keysInEnvFile(filePath)) {
    fileKeys.add(key);
  }
  loadEnvFile(filePath);
  sources.push(label);
}

function keysInEnvFile(filePath: string): string[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
      return match ? [match[1]] : [];
    });
}

function listEnvironments(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".env"))
    .map((fileName) => fileName.slice(0, -".env".length))
    .sort();
}

function availableMessage(dir: string): string {
  const names = listEnvironments(dir);
  return names.length > 0 ? names.join(", ") : "(none)";
}
