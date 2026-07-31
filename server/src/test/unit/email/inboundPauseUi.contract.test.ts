import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('inbound pause UI contract', () => {
  it('T034: pause/resume mutations are authenticated and use provider-config permission', () => {
    const source = read(
      'packages/integrations/src/actions/email-actions/inboundPauseActions.ts'
    );
    expect(source.match(/withAuth\(async/g)).toHaveLength(2);
    expect(source).toContain("hasPermission(user, 'ticket_settings', 'update', knex)");
  });

  it('T037: new pause copy uses i18n keys and interactive ids are kebab-case', () => {
    const card = read('packages/integrations/src/components/email/EmailProviderCard.tsx');
    const list = read('packages/integrations/src/components/email/EmailProviderList.tsx');
    const locale = JSON.parse(read('server/public/locales/en/msp/email-providers.json'));

    expect(card).toContain("t('providerCard.badges.paused')");
    expect(card).toContain("t('providerCard.actions.resume')");
    expect(card).toContain("t('providerCard.actions.pause')");
    expect(card).toContain("t('providerCard.pausedHelp')");
    expect(list).toContain("'providerCard.feedback.resumed'");
    expect(list).toContain('await resumeEmailProvider(provider.id)');
    expect(list).toContain('await pauseEmailProvider(provider.id)');
    expect(list).toContain('onRefresh();');
    expect(locale.providerCard.pausedHelp).toBeTruthy();
    expect(card).toContain("id={`${provider.inboundPausedAt ? 'resume' : 'pause'}-provider-${provider.id}`}");
    expect(card).toContain('onClick={() => onTogglePause(provider)}');
  });
});
