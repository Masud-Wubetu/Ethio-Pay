import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@ethio-pay/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@ethio-pay/chapa': path.resolve(__dirname, './packages/chapa/src/index.ts'),
      '@ethio-pay/telebirr': path.resolve(__dirname, './packages/telebirr/src/index.ts'),
      '@ethio-pay/sandbox': path.resolve(__dirname, './packages/sandbox/src/index.ts'),
      'ethio-pay': path.resolve(__dirname, './packages/ethio-pay/src/index.ts'),
    },
  },
});
