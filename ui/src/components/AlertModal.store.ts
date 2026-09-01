export type AlertVariant = "info" | "warning" | "error";

export interface AlertOptions {
  message: string;
  title?: string;
  confirmText?: string;
  variant?: AlertVariant;
}

export interface ConfirmOptions extends AlertOptions {
  cancelText?: string;
}

export interface AlertRequest {
  id: number;
  title: string;
  message: string;
  confirmText: string;
  /** Absent for plain alerts: only a confirm request renders a second button. */
  cancelText?: string;
  variant: AlertVariant;
  resolve: (confirmed: boolean) => void;
}

const DEFAULT_TITLES: Record<AlertVariant, string> = {
  info: "Notice",
  warning: "Warning",
  error: "Error",
};

let nextId = 1;
let queue: readonly AlertRequest[] = [];
const listeners = new Set<() => void>();

const setQueue = (next: readonly AlertRequest[]) => {
  queue = next;
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeAlerts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getAlertQueue = (): readonly AlertRequest[] => queue;

export const resolveCurrentAlert = (confirmed: boolean): void => {
  const current = queue[0];
  if (!current) {
    return;
  }
  setQueue(queue.slice(1));
  current.resolve(confirmed);
};

const toOptions = (input: string | ConfirmOptions): ConfirmOptions =>
  typeof input === "string" ? { message: input } : input;

const enqueue = (options: ConfirmOptions, withCancel: boolean): Promise<boolean> => {
  const variant = options.variant ?? "warning";
  return new Promise<boolean>((resolve) => {
    setQueue([
      ...queue,
      {
        id: nextId++,
        title: options.title ?? DEFAULT_TITLES[variant],
        message: options.message,
        confirmText: options.confirmText ?? "OK",
        cancelText: withCancel ? (options.cancelText ?? "Cancel") : undefined,
        variant,
        resolve,
      },
    ]);
  });
};

/**
 * Drop-in replacement for `window.alert`: resolves once the user presses the
 * button. Queued behind any dialog already on screen so two calls never stack.
 */
export const showAlert = async (input: string | AlertOptions): Promise<void> => {
  await enqueue(toOptions(input), false);
};

/** Drop-in replacement for `window.confirm`. */
export const showConfirm = (input: string | ConfirmOptions): Promise<boolean> =>
  enqueue(toOptions(input), true);
