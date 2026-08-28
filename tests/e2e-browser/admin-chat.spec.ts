import { test, expect, type Page } from '@playwright/test';

/**
 * Does the plugin actually mount inside Strapi's admin?
 *
 * Unit tests prove the logic and component tests prove the rendering, but
 * neither can catch a plugin that fails to register, a route that moved, or a
 * bundle that was never rebuilt. Every one of those has happened here: a
 * renamed plugin id moved the route from /ai-sdk to /ai-chat, and a stale admin
 * bundle once made a correct fix look like it had done nothing.
 *
 * Opt-in. Without credentials these skip rather than fail, because CI has no
 * Strapi to talk to.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD against a running Strapi to run these.',
);

async function signIn(page: Page) {
  await page.goto('/admin/auth/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL(/\/admin(?!\/auth)/, { timeout: 30_000 });
}

test.describe('AI Chat in the admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the plugin mounts at its own route', async ({ page }) => {
    // The route moved from /ai-sdk to /ai-chat when the id was renamed. A stale
    // bundle or an unregistered plugin both land on a 404 here.
    await page.goto('/admin/plugins/ai-chat');

    await expect(page.getByRole('heading', { name: /AI Chat/i })).toBeVisible();
  });

  test('the composer is present and usable', async ({ page }) => {
    await page.goto('/admin/plugins/ai-chat');

    const input = page.getByPlaceholder(/type your message/i);
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });

  test('the context badge reports a real number', async ({ page }) => {
    // Regression guard: the badge read "NaN / NaN" while the endpoint was
    // returning nulls for an undetectable window.
    await page.goto('/admin/plugins/ai-chat');

    const badge = page.getByText(/\d[\dKk.]*\s*(tokens|\/)/i).first();
    await expect(badge).toBeVisible();
    await expect(badge).not.toHaveText(/NaN|undefined|null/i);
  });

  test('the old route is gone rather than silently serving', async ({ page }) => {
    const response = await page.goto('/admin/plugins/ai-sdk');

    // Strapi renders its own not-found page; what matters is that the chat is
    // not there under the previous id.
    await expect(page.getByRole('heading', { name: /^AI Chat$/i })).toHaveCount(0);
    expect(response).toBeTruthy();
  });

  test('no console errors on load', async ({ page }) => {
    // A bundle built against a renamed module fails here and nowhere else.
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/admin/plugins/ai-chat');
    await page.waitForTimeout(2000);

    const relevant = errors.filter((e) => !/favicon|third-party|analytics/i.test(e));
    expect(relevant, `console errors: ${relevant.join(' | ')}`).toHaveLength(0);
  });
});
