/* @vitest-environment node */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/customization-wiring.test.tsx */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('keyboard shortcuts settings UI contract', () => {
  it('adds a keyboard-shortcuts tab to SettingsPage with Keyboard icon', () => {
    const source = read('server/src/components/settings/SettingsPage.tsx');
    expect(source).toContain("id: 'keyboard-shortcuts'");
    expect(source).toContain('icon: Keyboard');
    expect(source).toContain('<KeyboardShortcutsSettings />');
  });

  it('uses shared settings components and preference-backed immediate updates', () => {
    const source = read('server/src/components/settings/general/KeyboardShortcutsSettings.tsx');
    expect(source).toContain('useKeyboardShortcutPreferences');
    expect(source).toContain('Table');
    expect(source).toContain('Switch');
    expect(source).toContain('LoadingIndicator');
    expect(source).toContain('ConfirmationDialog');
    expect(source).toContain('toast.success');
    expect(source).toContain('handleError');
    expect(source).not.toContain('Save');
  });

  it('implements capture, clear/reset, disable, reset-all, conflicts, ids, and variants', () => {
    const source = read('server/src/components/settings/general/KeyboardShortcutsSettings.tsx');
    expect(source).toContain('bindingFromEvent');
    expect(source).toContain('setActionBindings');
    expect(source).toContain('setActionDisabled');
    expect(source).toContain('keyboard-shortcuts-reset-all-confirmation');
    expect(source).toContain('keyboard-shortcuts-conflict-confirmation');
    expect(source).toContain('variant="ghost"');
    expect(source).toContain('variant="outline"');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('id={`keyboard-shortcut-capture-');
    expect(source).toContain('id={`keyboard-shortcut-enabled-');
    expect(source).toContain('id={`keyboard-shortcut-reset-');
  });
});
