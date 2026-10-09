import react from "@vitejs/plugin-react";
import { viteYak } from "next-yak/vite";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import { type Env, EnvSchema } from "./env.schema.ts";
import { loadAppEnv } from "./load-env.ts";
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
  const env = loadAppEnv();
  // Use env var if set (from CI/CD), otherwise fallback to package.json version
  env.REACT_APP_VERSION = env.REACT_APP_VERSION || pkg.version;
  env.REACT_APP_READ_ONLY_ETH_NODE_URL ??= getAlchemyUrl(
    Number(env.REACT_APP_CHAIN_ID ?? env.CHAIN_ID),
    env.ALCHEMY_API_KEY,
  );

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
    server: {
      port: 3001,
    },
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
      // Extract css`` / styled`` before the React plugin sees the source.
      viteYak({
        minify: mode !== "development",
        experiments: {
          // Nested `input` / `h3` / `.link` selectors stay global CSS, not CSS modules.
          transpilationMode: "Css",
        },
      }),
      react(),
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

enum ChainId {
  EthereumMainnet = 1,
  EthereumSepolia = 11155111,
  BaseMainnet = 8453,
  BaseSepolia = 84532,
  ArbitrumMainnet = 42161,
  ArbitrumSepolia = 421614,
  Hardhat = 31337,
}

function getAlchemyUrl(chainID: number, apiKey: string) {
  if (chainID === ChainId.Hardhat) {
    return `http://127.0.0.1:8545`;
  }

  const slug = chainIdToAlchemySlug[chainID as ChainId];
  if (!slug) {
    throw new Error(`Unsupported chain ID: ${chainID}`);
  }

  return alchemyUrl(slug, apiKey);
}

const chainIdToAlchemySlug: Record<ChainId, string> = {
  [ChainId.EthereumMainnet]: "eth-mainnet",
  [ChainId.EthereumSepolia]: "eth-sepolia",
  [ChainId.BaseMainnet]: "base-mainnet",
  [ChainId.BaseSepolia]: "base-sepolia",
  [ChainId.ArbitrumMainnet]: "arb-mainnet",
  [ChainId.ArbitrumSepolia]: "arb-sepolia",
  [ChainId.Hardhat]: "hardhat",
};

function alchemyUrl(network: string, apiKey: string) {
  return `https://${network}.g.alchemy.com/v2/${apiKey}`;
}
