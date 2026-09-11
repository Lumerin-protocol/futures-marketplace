import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig, loadEnv } from "vite";
import svgr from "vite-plugin-svgr";
import { type Env, EnvSchema } from "./env.schema.ts";
import pkg from "./package.json" with { type: "json" };
import { newAjv } from "./validator.ts";
import mkcert from "vite-plugin-mkcert";
// import { analyzer } from "vite-bundle-analyzer";
import { imagetools } from "vite-imagetools";
import { seedMetaPlugin } from "./vite-plugin-seed-meta.ts";

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Env {}
  }
}

const envsToInject = Object.keys(EnvSchema.properties);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Use env var if set (from CI/CD), otherwise fallback to package.json version
  env.REACT_APP_VERSION = env.REACT_APP_VERSION || pkg.version;

  const ajv = newAjv();
  const validate = ajv.compile(EnvSchema);

  if (!validate(env)) {
    throw new Error(
      `Invalid environment variables: ${ajv.errorsText(validate.errors, {
        dataVar: "ENV",
        separator: ".",
      })}`,
    );
  }

  // TODO: migrate to import.meta.env
  // Temporary hack to support process.env way to get env variables

  // Simply injecting our env variables for each occurence of process.env
  // doesn't work because it overwrites existing process.env variables
  // and screws the electron dev mode
  //
  // define: {
  //   'process.env': JSON.stringify(env) // don't do it
  // }
  //
  // so we need to define them in a way that they are merged with the existing process.env

  const processEnvDefineMap: Record<string, string> = {};

  for (const key of envsToInject) {
    processEnvDefineMap[`process.env.${key}`] = JSON.stringify(env[key as keyof Env]);
  }

  return {
    define: processEnvDefineMap,
    plugins: [
      // Inject version into HTML meta tag for easy verification
      {
        name: 'html-transform',
        transformIndexHtml(html) {
          const appVersion = env.REACT_APP_VERSION || pkg.version || 'unknown';
          return html.replace(
            '</head>',
            `\t<meta name="application-version" content="${appVersion}" />\n</head>`
          );
        },
      },
      react(),
      // plugin-react 6 no longer hosts Babel. Emotion's label plugin runs
      // through Rolldown so `styled` still gets `css-…-PositionCard` class
      // names in dev.
      babel({
        plugins: ["@emotion/babel-plugin"],
      }),
      imagetools({
        defaultDirectives: (_url) => {
          return new URLSearchParams({
            format: "webp",
            quality: "80",
            effort: "6",
            alphaQuality: "50",
          });
        },
      }),
      svgr(),
      seedMetaPlugin(),
      env.DEV_SERVER_HTTPS ? mkcert() : null,

      // analyzer({
      //   openAnalyzer: false,
      //   fileName: "bundle-analyzer.html",
      //   analyzerPort: 1234,
      // }),
    ],
    build: {
      sourcemap: "hidden",
      rolldownOptions: {
        treeshake: true,
        output: {
          entryFileNames: (info) => {
            return `assets/entry/${info.name}-[hash].js`;
          },
          chunkFileNames: "assets/chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
      outDir: "build", // CRA's default build output
    },
  };
});
