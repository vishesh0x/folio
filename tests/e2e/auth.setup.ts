import { test as setup, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, AUTH_FILE, freshIp } from './helpers';
import { SETUP_TOKEN } from '../../playwright.config';

// Creates the single admin account through the real "Set up your site" form (or signs in if the server was reused), then
// saves the session so the other tests can start signed in.
setup('create admin and save session', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': freshIp() });
  await page.goto('/auth');
  if (await page.getByRole('heading', { name: 'Set up your site' }).isVisible()) {
    await page.getByLabel('Setup token').fill(SETUP_TOKEN);
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.locator('#s-pw').fill(ADMIN_PASSWORD);
    await page.locator('#s-pw2').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Create admin account' }).click();
  } else {
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.locator('#pw').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.context().storageState({ path: AUTH_FILE });
});
