import { expect, type Locator, type Page } from "@playwright/test";

/** The app's one alert/confirm dialog (ui/src/components/AlertModal.tsx), raised by `showAlert`. */
export class AlertDialog {
  readonly root: Locator;
  readonly message: Locator;

  constructor(page: Page) {
    this.root = page.getByRole("alertdialog");
    this.message = this.root.locator("#alert-modal-message");
  }

  async expectMessage(text: string | RegExp): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.message).toContainText(text);
  }

  /** Presses the primary button; the dialog has no close icon or Escape. */
  async accept(): Promise<void> {
    await this.root.getByRole("button").last().click();
    await expect(this.root).toBeHidden();
  }
}
