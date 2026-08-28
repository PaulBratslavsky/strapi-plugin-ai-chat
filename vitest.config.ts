import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The plugin's own build handles JSX; vitest needs telling separately.
  esbuild: { jsx: 'automatic' },
  test: {
    // Server tests run in node; component tests need a DOM. Split by
    // directory rather than forcing one environment on both.
    environment: 'node',
    environmentMatchGlobs: [['tests/components/**', 'jsdom']],
    setupFiles: ['tests/components/setup.ts'],
    // Only these directories. The rest of tests/ holds standalone scripts that
    // call process.exit() and must not run under vitest.
    include: ['tests/{components,helpers,lib,mcp,services,tools}/**/*.test.{ts,tsx}'],
    testTimeout: 10_000,
  },
});
