import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * notificationHooks.ts is re-exported by the actions barrel into client
 * components (NotificationSettings/NotificationCategories are 'use client'),
 * and it is intentionally NOT a "use server" module — so unlike its action
 * siblings it is bundled verbatim into the browser build. A static import of
 * lib/notificationDelivery (which pulls @alga-psa/db, @alga-psa/co-managed and
 * @alga-psa/storage) broke every /msp route whose layout mounts
 * WorkspaceProviders ("Module not found: Can't resolve 'fs'" in turbopack).
 * The delivery wrapper must be injected by the server-only caller instead.
 */
describe('notificationHooks client-bundle safety', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'notificationHooks.ts'),
    'utf8',
  );

  it('has no runtime imports (only type imports), so no server-only module can leak into client bundles', () => {
    const runtimeImports = source
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line) && !/^\s*import\s+type\s/.test(line));
    expect(runtimeImports).toEqual([]);
  });

  it('does not import notificationDelivery', () => {
    const importLines = source.split('\n').filter((line) => /^\s*import\s/.test(line));
    expect(importLines.filter((line) => line.includes('notificationDelivery'))).toEqual([]);
  });
});
