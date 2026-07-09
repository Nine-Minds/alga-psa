// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const actionsSource = readFileSync(resolve(__dirname, 'closeRuleActions.ts'), 'utf8');
const boardSettingsSource = readFileSync(
  resolve(__dirname, '../../components/settings/BoardsSettings.tsx'),
  'utf8',
);

describe('auto-close notification suppression contract', () => {
  it('persists and returns suppression fields on board auto-close rules', () => {
    expect(actionsSource).toContain('suppress_contact_notifications: boolean');
    expect(actionsSource).toContain('suppress_internal_notifications: boolean');
    expect(actionsSource).toContain("'suppress_contact_notifications'");
    expect(actionsSource).toContain("'suppress_internal_notifications'");
    expect(actionsSource).toContain('suppress_contact_notifications: input.suppress_contact_notifications ?? false');
    expect(actionsSource).toContain('suppress_internal_notifications: input.suppress_internal_notifications ?? false');
    expect(actionsSource).toContain('suppress_contact_notifications: input.suppress_contact_notifications ?? existing.suppress_contact_notifications ?? false');
    expect(actionsSource).toContain('suppress_internal_notifications: input.suppress_internal_notifications ?? existing.suppress_internal_notifications ?? false');
  });

  it('validates internal suppression requires contact suppression', () => {
    expect(actionsSource).toContain('input.suppress_internal_notifications && !input.suppress_contact_notifications');
    expect(actionsSource).toContain('suppress_internal_notifications requires suppress_contact_notifications');
  });

  it('renders coupled auto-close suppression controls in board settings', () => {
    expect(boardSettingsSource).toContain('auto-close-suppress-contact-${index}');
    expect(boardSettingsSource).toContain('auto-close-suppress-internal-${index}');
    expect(boardSettingsSource).toContain('suppress_contact_notifications: checked');
    expect(boardSettingsSource).toContain('suppress_internal_notifications: checked ? rule.suppress_internal_notifications : false');
    expect(boardSettingsSource).toContain('disabled={!rule.suppress_contact_notifications}');
    expect(boardSettingsSource).toContain('suppress_contact_notifications: rule.suppress_contact_notifications');
    expect(boardSettingsSource).toContain('suppress_internal_notifications: rule.suppress_internal_notifications');
  });
});
