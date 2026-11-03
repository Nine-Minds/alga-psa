import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = resolve(repoRoot, 'packages/co-managed/src/coManagedUpgradePurchaseStates.cjs');
const destination = resolve(repoRoot, 'ee/temporal-workflows/dist/packages/co-managed/src/coManagedUpgradePurchaseStates.cjs');

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
