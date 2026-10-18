import type { Page } from "@playwright/test";

/**
 * Pre-existing app errors that would otherwise fail every run. They are still
 * attached to the report, under "known". Remove an entry once the UI is fixed.
 */
const KNOWN_APP_ERRORS: RegExp[] = [
  // ui/src/hooks/useAnalytics.ts: react-ga4 is CommonJS, so under the Vite dev
  // server the dynamic import's `default` is the module object, not ReactGA.
  /ReactGA\.initialize is not a function/,
];

/**
 * Collects the console output a healthy page must not produce: uncaught
 * exceptions, and failed contract reads, which ui/src/Web3Provider.tsx logs as
 * `[web3][read] <label> failed:`. Other console errors (wallet SDK noise,
 * third-party telemetry) are kept for the report but do not fail a test.
 */
export class ConsoleErrors {
  readonly uncaught: string[] = [];
  readonly failedReads: string[] = [];
  readonly other: string[] = [];
  readonly known: string[] = [];

  constructor(
    page: Page,
    private readonly allowlist: RegExp[],
  ) {
    page.on("pageerror", (error) => this.record(error.stack ?? error.message, this.uncaught));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      this.record(text, text.includes("[web3][read]") ? this.failedReads : this.other);
    });
  }

  /** What fails a test: uncaught exceptions and failed contract reads. */
  get blocking(): string[] {
    return [...this.uncaught, ...this.failedReads];
  }

  /** Everything collected, labelled, for the report attachment. */
  get report(): string {
    const sections = { uncaught: this.uncaught, "failed reads": this.failedReads, other: this.other, known: this.known };
    return Object.entries(sections)
      .filter(([, texts]) => texts.length > 0)
      .map(([name, texts]) => `## ${name}\n\n${texts.join("\n\n")}`)
      .join("\n\n");
  }

  private record(text: string, bucket: string[]): void {
    if (KNOWN_APP_ERRORS.some((pattern) => pattern.test(text))) this.known.push(text);
    else if (!this.allowlist.some((pattern) => pattern.test(text))) bucket.push(text);
  }
}
