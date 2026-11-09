import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['e2e/**/*.e2e-spec.ts', 'src/**/*.spec.ts'],
        watch: false,
        // Each e2e spec boots a Vendure server; the first run also builds the test database
        testTimeout: process.env.E2E_DEBUG ? 1_800_000 : 60_000,
        hookTimeout: 180_000,
        // Spec files each start their own server on their own port
        fileParallelism: false,
        server: {
            deps: {
                // Avoids duplicate graphql "realm" errors
                fallbackCJS: true,
            },
        },
    },
    resolve: {
        alias: {
            graphql: 'graphql/index.js',
        },
    },
    plugins: [
        // Vitest's own transform doesn't emit decorator metadata, which NestJS and TypeORM need
        swc.vite({
            jsc: {
                transform: {
                    useDefineForClassFields: false,
                },
            },
        }),
    ],
});
