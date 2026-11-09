// The Vendure CLI expects a project with `src/vendure-config.ts`; this package's src/ is the plugin,
// so the dev server's migrations are managed with this script instead.
// Usage: pnpm run migrate generate <Name> | run | revert
import { generateMigration, revertLastMigration, runMigrations } from '@vendure/core';
import path from 'path';

import { config } from './vendure-config';

async function main() {
    const [command, name] = process.argv.slice(2);
    if (command === 'generate' && name) {
        await generateMigration(config, { name, outputDir: path.join(__dirname, 'migrations') });
    } else if (command === 'run') {
        await runMigrations(config);
    } else if (command === 'revert') {
        await revertLastMigration(config);
    } else {
        throw new Error('Usage: pnpm run migrate generate <Name> | run | revert');
    }
}

main().then(
    () => process.exit(0),
    (e: unknown) => {
        console.error(e);
        process.exit(1);
    },
);
