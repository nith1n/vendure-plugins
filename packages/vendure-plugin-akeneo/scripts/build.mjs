// Builds the publishable package: compiles the plugin to dist/ and copies the dashboard
// extension's sources next to it. The host project's dashboard build compiles those itself,
// using the `dashboard` path in the plugin metadata (relative to the compiled plugin file).
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

rmSync(join(root, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit' });
cpSync(join(root, 'src/dashboard'), join(root, 'dist/dashboard'), { recursive: true });
