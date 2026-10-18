import { expect, type Locator } from "@playwright/test";

/**
 * The app's numeric fields filter each keystroke in `onBeforeInput`, which
 * rejects the single multi-character insert `locator.fill()` performs, so the
 * value is cleared and typed one character at a time.
 */
export async function typeInto(field: Locator, value: string): Promise<void> {
  await field.fill("");
  await field.pressSequentially(value);
  await expect(field).toHaveValue(value);
}
