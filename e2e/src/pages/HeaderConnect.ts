import { expect, type Locator, type Page } from "@playwright/test";
import type { Address } from "viem";
import { TESTIDS } from "../testids";
import type { MockWallet } from "../wallet/install";

/** The header's address as AccountButton prints it: truncateAddress(address, MEDIUM). */
export function headerAddressLabel(address: Address): string {
  return `${address.slice(0, 7)}...${address.slice(-5)}`;
}

/**
 * The wallet controls at the top right (HeaderConnect) and the Reown AppKit
 * modal they open. AppKit renders in open shadow roots, which Playwright
 * locators pierce; the ids used here are AppKit's own data-testids.
 */
export class HeaderConnect {
  readonly accountButton: Locator;
  readonly chainButton: Locator;
  readonly connectorIcon: Locator;
  readonly appKit: Locator;

  constructor(private readonly page: Page) {
    this.accountButton = page.getByTestId(TESTIDS.accountButton);
    this.chainButton = page.getByTestId(TESTIDS.chainButton);
    this.connectorIcon = page.getByAltText("connector icon");
    this.appKit = page.getByTestId("w3m-modal-card");
  }

  async expectDisconnected(): Promise<void> {
    await expect(this.accountButton).toHaveText("Connect wallet", { timeout: 30_000 });
  }

  async expectConnected(address: Address): Promise<void> {
    await expect(this.accountButton).toHaveText(headerAddressLabel(address), { ignoreCase: true, timeout: 30_000 });
  }

  /** "Connect wallet" → AppKit's Connect view → the mock wallet, as a user picks an injected wallet. */
  async connect(wallet: MockWallet): Promise<void> {
    await this.expectDisconnected();
    await this.accountButton.click();
    await expect(this.appKit).toBeVisible();
    const option = this.page
      .getByTestId(`wallet-selector-${wallet.rdns}`)
      .or(this.appKit.getByText(wallet.name, { exact: true }))
      .first();
    await option.click();
    await this.expectConnected(wallet.address);
    await expect(this.appKit).toBeHidden();
  }

  /** Account button → AppKit's Account view → Disconnect. */
  async disconnect(): Promise<void> {
    await this.accountButton.click();
    await this.page.getByTestId("disconnect-button").click();
    await this.expectDisconnected();
    await expect(this.appKit).toBeHidden();
  }
}
