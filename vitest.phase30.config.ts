import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/phase30-patient.integration.spec.ts'],
    fileParallelism: false,
    testTimeout: 45_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
