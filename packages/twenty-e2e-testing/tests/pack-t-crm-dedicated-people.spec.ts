/**
 * ECN-649 M1 — T-CRM-DEDICATED dedicated-host leg (People + isolation).
 *
 * Pack SoT: RESEARCH/HERMES_T_CRM_DEDICATED_PACK_2026-08-06.md
 * Shell Install/Open: ECN-Monorepo frontend/e2e/pack-t-crm-dedicated.spec.ts
 *
 * Steps 5–6 of Hermes SoT:
 *   5 Create contact tagged TCRMDED-<UTC>
 *   6 No cross-tenant (REQUIRED — T1 bar)
 *
 * Default CI skips until ECN_PACK_E2E=1 (dedicated mint seed wired).
 */

import { expect, test } from '../lib/fixtures/screenshot';

const packLive = process.env.ECN_PACK_E2E === '1';

test.describe('T-CRM-DEDICATED dedicated People', () => {
  test.skip(
    !packLive,
    'Set ECN_PACK_E2E=1 when dedicated mint + auth seed are ready',
  );

  test('5: create People row with TCRMDED marker', async ({ page }) => {
    const marker =
      process.env.ECN_PACK_TCRMDED_MARKER ??
      `TCRMDED-${new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .slice(0, 15)}Z`;

    test.info().annotations.push(
      { type: 'pack', description: 'T-CRM-DEDICATED' },
      { type: 'marker', description: marker },
    );

    await page.goto('/objects/people');
    await page.getByRole('button', { name: 'Create new Person' }).click();

    const firstNameInput = page.getByRole('textbox', { name: /First name/i });
    await expect(firstNameInput).toBeFocused();
    await firstNameInput.fill(marker);
    const lastNameInput = page.getByRole('textbox', { name: /Last name/i });
    await lastNameInput.fill('Pack');

    await page.keyboard.press('Enter');
    await expect(page.getByText(marker).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('6: isolation — marker absent on second workspace', async ({
    page,
    browser,
  }) => {
    test.skip(
      process.env.ECN_PACK_ISOLATION !== '1',
      'Set ECN_PACK_ISOLATION=1 + ECN_PACK_ISO_STORAGE_STATE for second org',
    );

    const marker = process.env.ECN_PACK_TCRMDED_MARKER;
    test.skip(!marker, 'ECN_PACK_TCRMDED_MARKER required for isolation assert');

    const isoState = process.env.ECN_PACK_ISO_STORAGE_STATE;
    test.skip(!isoState, 'ECN_PACK_ISO_STORAGE_STATE path required');

    const ctx = await browser.newContext({ storageState: isoState });
    const isoPage = await ctx.newPage();
    await isoPage.goto('/objects/people');
    await expect(isoPage.getByText(marker!).first()).toHaveCount(0, {
      timeout: 15_000,
    });
    await ctx.close();
    // Keep page typed so fixture screenshot cleanup stays happy
    await page.goto('/objects/people');
  });
});
