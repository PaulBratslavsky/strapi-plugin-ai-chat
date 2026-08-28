import { defineConfig } from '@playwright/test';

/**
 * Browser tests against a running Strapi admin.
 *
 * Opt-in, because they need a server and an admin login that CI does not have.
 * Set E2E_BASE_URL, E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run them; without
 * those the specs skip rather than fail, so `npm test` stays green on a machine
 * that cannot run them.
 *
 * These cover what unit and component tests cannot: that the plugin actually
 * mounts inside Strapi's admin, under its real routes, with its real bundle.
 */
export default defineConfig({
  testDir: './tests/e2e-browser',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:1337',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
