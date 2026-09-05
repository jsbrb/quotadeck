import { defineConfig } from 'vitest/config';

// Hermetic suite: node environment, no browser/Chrome runtime, no network.
// Every external edge (browser, clock, transport) is injected as a fake.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
