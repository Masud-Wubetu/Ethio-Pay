import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@ethio-pay/core': path.resolve(__dirname, './packages/core/src/index.ts'),
    },
  },
});
