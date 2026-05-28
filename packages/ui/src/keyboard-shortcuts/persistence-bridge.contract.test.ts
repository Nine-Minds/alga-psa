/* @vitest-environment node */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/customization-wiring.test.tsx */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

describe('MSP shortcut persistence bridge contract', () => {
  it('uses useUserPreference with the keyboard_shortcuts_v1 key and supports localStorage-only mode', () => {
    const source = readFileSync(resolve(repoRoot, 'server/src/hooks/useKeyboardShortcutPreferenceStorage.ts'), 'utf8');
    expect(source).toContain('useUserPreference(KEYBOARD_SHORTCUTS_PREFERENCE_KEY');
    expect(source).toContain('localStorageKey: KEYBOARD_SHORTCUTS_PREFERENCE_KEY');
    expect(source).toContain('skipServerFetch: options.skipServerFetch');
    expect(source).toContain('...preference');
  });
});
