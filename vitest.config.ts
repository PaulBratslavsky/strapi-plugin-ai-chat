import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Include only test files under specific directories to avoid running
    // ai-sdk.test.ts and mcp.test.ts which are standalone scripts that
    // call process.exit() and should not be run under vitest.
    include: ['tests/{helpers,lib,mcp}/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
