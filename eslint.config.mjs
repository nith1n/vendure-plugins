// @ts-check
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        // Build output and generated code
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            'packages/*/dev-server/static/**',
            'packages/*/dev-server/gql/**',
            'packages/*/dev-server/migrations/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                project: ['./packages/*/tsconfig.json', './packages/*/tsconfig.dashboard.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Async correctness: the bugs that matter most in job queue / API code
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/consistent-type-imports': 'off',
        },
    },
    {
        // Plain JS config files are not part of any tsconfig
        files: ['**/*.{js,mjs,cjs}'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    prettierConfig,
);
