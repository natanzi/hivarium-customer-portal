import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'worker',
          environment: 'node',
          include: ['tests/worker/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/components/setup.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});