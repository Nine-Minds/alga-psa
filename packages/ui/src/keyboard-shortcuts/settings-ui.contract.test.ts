/* @vitest-environment node */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/profiles.test.ts */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/customization-wiring.test.tsx */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

const panel = 'server/src/components/keyboard-shortcuts/KeyboardShortcutsPanel.tsx';

describe('keyboard shortcuts UI placement contract', () => {
  it('lives as a tab in the user Profile, not the admin Settings page', () => {
    const profile = read('server/src/components/settings/profile/UserProfile.tsx');
    expect(profile).toContain("id: 'keyboard-shortcuts'");
    expect(profile).toContain('<KeyboardShortcutsPanel />');
    expect(profile).toContain("profile.tabs.keyboardShortcuts");

    const settings = read('server/src/components/settings/SettingsPage.tsx');
    expect(settings).not.toContain("id: 'keyboard-shortcuts'");
    expect(settings).not.toContain('KeyboardShortcutsSettings');
  });

  it('is reachable via the ?tab= deep-link allowlist', () => {
    const availability = read('packages/integrations/src/lib/calendarAvailability.ts');
    expect(availability).toContain("'keyboard-shortcuts'");
  });

  it('is the visual-keyboard panel wired to the provider single source', () => {
    const source = read(panel);
    expect(source).toContain('useKeyboardShortcutPreferences');
    expect(source).toContain('getShortcutProfiles');
    expect(source).toContain('KB_ROWS');
    expect(source).toContain('buildIndex');
    expect(source).toContain('ConfirmationDialog');
    expect(source).toContain('handleError');
    expect(source).toContain('toast.success');
  });

  it('implements real key capture, conflict reassign, disable, reset, profiles', () => {
    const source = read(panel);
    expect(source).toContain('bindingFromEvent');
    expect(source).toContain("window.addEventListener('keydown'");
    expect(source).toContain('setActionBindings');
    expect(source).toContain('setActionDisabled');
    expect(source).toContain('setProfile');
    expect(source).toContain('resetAction');
    expect(source).toContain('resetAllShortcuts');
    expect(source).toContain('keyboard-shortcuts-reset-all-confirmation');
    expect(source).toContain('keyboard-shortcuts-conflict-confirmation');
    expect(source).toContain('id="keyboard-shortcuts-copy"');
  });
});
