/**
 * Runs inside the page (serialized by `context.addInitScript`), so it must be
 * self-contained: no imports and no references to module scope.
 */

export interface InPageWalletConfig {
  address: string;
  chainId: number;
  /** Name of the `context.exposeBinding` bridge to the Node-side signer. */
  bindingName: string;
  /** localStorage key that remembers the dapp was authorized, like a real wallet does across reloads. */
  storageKey: string;
  info: { uuid: string; name: string; icon: string; rdns: string };
}

type BridgeResponse = { result?: unknown; error?: { code: number; message: string; data?: unknown } };

export function injectMockWallet(config: InPageWalletConfig): void {
  type Listener = (...args: unknown[]) => void;
  const scope = window as unknown as Record<string, unknown>;
  if (scope.__e2eMockWallet) return;

  const chainIdHex = `0x${config.chainId.toString(16)}`;
  const listeners = new Map<string, Set<Listener>>();
  const permission = () => ({
    parentCapability: "eth_accounts",
    caveats: [{ type: "restrictReturnedAccounts", value: [config.address] }],
  });

  const isAuthorized = (): boolean => {
    try {
      return window.localStorage.getItem(config.storageKey) === "1";
    } catch {
      return false;
    }
  };
  const setAuthorized = (authorized: boolean): void => {
    try {
      if (authorized) window.localStorage.setItem(config.storageKey, "1");
      else window.localStorage.removeItem(config.storageKey);
    } catch {
      // Opaque origins (about:blank) have no storage; nothing to remember there.
    }
  };

  const providerError = (code: number, message: string, data?: unknown) =>
    Object.assign(new Error(message), { code, data });

  const callNode = async (method: string, params: unknown[]): Promise<unknown> => {
    const bridge = scope[config.bindingName] as ((payload: unknown) => Promise<BridgeResponse>) | undefined;
    if (typeof bridge !== "function") throw providerError(4900, "E2E wallet bridge is not available");
    const response = await bridge({ method, params });
    if (response.error) throw providerError(response.error.code, response.error.message, response.error.data);
    return response.result;
  };

  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    const args = Array.isArray(params) ? params : params === undefined ? [] : [params];
    switch (method) {
      case "eth_chainId":
        return chainIdHex;
      case "net_version":
        return String(config.chainId);
      case "eth_accounts":
        return isAuthorized() ? [config.address] : [];
      case "eth_coinbase":
        return isAuthorized() ? config.address : null;
      case "eth_requestAccounts":
        setAuthorized(true);
        return [config.address];
      case "wallet_requestPermissions":
        setAuthorized(true);
        return [permission()];
      case "wallet_getPermissions":
        return isAuthorized() ? [permission()] : [];
      case "wallet_revokePermissions":
        setAuthorized(false);
        return null;
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        const requested = Number.parseInt(String((args[0] as { chainId?: string } | undefined)?.chainId), 16);
        if (requested !== config.chainId) {
          throw providerError(4902, `E2E wallet is pinned to chain ${config.chainId}, not ${requested}`);
        }
        return null;
      }
      case "wallet_watchAsset":
        return true;
      case "eth_sendTransaction":
      case "wallet_sendTransaction":
      case "eth_signTypedData_v4":
      case "personal_sign":
        if (!isAuthorized()) throw providerError(4100, "E2E wallet: the dapp is not authorized");
        return callNode(method, args);
      default:
        if (method.startsWith("wallet_")) throw providerError(4200, `E2E wallet does not support ${method}`);
        return callNode(method, args);
    }
  };

  const provider = {
    isE2EMockWallet: true,
    request,
    enable: () => request({ method: "eth_requestAccounts" }),
    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return provider;
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
    off(event: string, listener: Listener) {
      return provider.removeListener(event, listener);
    },
  };

  scope.__e2eMockWallet = provider;
  scope.ethereum = provider;

  const detail = Object.freeze({ info: Object.freeze({ ...config.info }), provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}
