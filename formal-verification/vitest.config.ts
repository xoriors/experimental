import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Each differential property makes a few thousand round trips to the Lean oracle.
    testTimeout: 60_000,
  },
});
