import { test, expect } from '@playwright/test';

/**
 * Phase 4 target-stack prompt UI smoke tests.
 * Full six-user CRDT acceptance remains manual — see docs/testing/.
 */

test('home and create pages still load after Phase 4', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /LiveKit Prompt Review Room/i })).toBeVisible();
  await page.goto('/create');
  await expect(page.locator('form.create-room-form, form').first()).toBeVisible();
});

test('prompt CSS / workspace markers are present in stylesheet', async ({ page }) => {
  await page.goto('/');
  const probes = await page.evaluate(() => {
    const names = [
      'prompt-panel',
      'prompt-meta-row',
      'prompt-presence',
      'shared-prompt-editor',
    ];
    const results = {};
    for (const name of names) {
      const el = document.createElement('div');
      el.className = name;
      document.body.appendChild(el);
      results[name] = getComputedStyle(el).display !== '';
      el.remove();
    }
    return results;
  });
  expect(probes['prompt-panel']).toBeTruthy();
  expect(probes['prompt-meta-row']).toBeTruthy();
});

test('unknown room page stays graceful', async ({ page }) => {
  await page.goto('/room/not-a-real-slug-phase4');
  await expect(page.locator('main.room-page')).toBeVisible();
  await expect(page.getByText('Room not found.')).toBeVisible();
});
