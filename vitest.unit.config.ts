import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/worker/access-jwt.test.ts', 'tests/worker/adapters.test.ts'],
        testTimeout: 30_000,
    },
});
