import { defineConfig } from 'vitest/config';

import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Mirrors the `@/*` path alias from tsconfig so test files can use the same
  // import specifiers as application code.
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // The engine is pure ES modules with no DOM dependency; `TextDecoder` and
    // `structuredClone` are both global in modern Node, so jsdom would only
    // add startup cost.
    environment: 'node',
    include: ['app/worker/__tests__/**/*.test.ts', 'app/lib/__tests__/**/*.test.ts', 'app/components/__tests__/**/*.test.ts'],
  },
});
