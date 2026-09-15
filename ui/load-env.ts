import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

/**
 * Load env with increasing priority:
 * 1. `config/{APP_ENV}.env`
 * 2. repo-root `../.env`
 * 3. `cwd/.env`
 * 4. shell `process.env` (wins on conflict)
 *
 * APP_ENV is taken from the shell, then `cwd/.env`, then `../.env`.
 */
export function loadAppEnv(cwd = process.cwd()): Record<string, string> {
  const dir = configDir(cwd);
  const rootFile = path.resolve(cwd, "../.env");
  const localFile = path.join(cwd, ".env");
  const root = parseEnvFile(rootFile);
  const local = parseEnvFile(localFile);
  const name = process.env.APP_ENV || local.APP_ENV || root.APP_ENV;
  const loaded: Record<string, string> = {};
  const sources: string[] = [];

  if (name) {
    const configFile = path.join(dir, `${name}.env`);
    if (!fs.existsSync(configFile)) {
      throw new Error(
        `[load-env] config/${name}.env not found. Available: ${availableMessage(dir)}`,
      );
    }
    Object.assign(loaded, parseEnvFile(configFile));
    sources.push(`config/${name}.env`);
  }

  Object.assign(loaded, root);
  if (fs.existsSync(rootFile)) {
    sources.push("../.env");
  }

  Object.assign(loaded, local);
  if (fs.existsSync(localFile)) {
    sources.push(".env");
  }

  console.log(`[load-env] APP_ENV=${name ?? "(unset)"} loaded: ${sources.join(" + ") || "(none)"}`);

  if (!name && !fs.existsSync(rootFile) && !fs.existsSync(localFile)) {
    throw new Error(
      `[load-env] set APP_ENV (shell or .env). Available: ${availableMessage(dir)}`,
    );
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (
      key in loaded ||
      key.startsWith("REACT_APP_") ||
      key === "DEV_SERVER_HTTPS" ||
      key === "ALCHEMY_API_KEY"
    ) {
      loaded[key] = value;
    }
  }

  return loaded;
}

function configDir(cwd: string): string {
  return path.resolve(cwd, "../config");
}

function listEnvironments(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".env"))
    .map((fileName) => fileName.slice(0, -".env".length))
    .sort();
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return parse(fs.readFileSync(filePath));
}

function availableMessage(dir: string): string {
  const names = listEnvironments(dir);
  return names.length > 0 ? names.join(", ") : "(none)";
}
