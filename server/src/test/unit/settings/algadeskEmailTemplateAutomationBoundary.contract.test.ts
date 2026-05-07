import fs from 'fs';
import path from 'path';

describe('Algadesk email template automation boundary', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  it('hides notifications email-templates tab in main settings notifications composition for Algadesk', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/components/settings/general/NotificationsTab.tsx'),
      'utf8',
    );

    expect(source).toContain("const ALGADESK_EMAIL_TAB_IDS = ['settings', 'categories', 'telemetry'] as const;");
    expect(source).toContain('const isAlgadesk = productCode === \'algadesk\';');
    expect(source).toContain('isAlgadesk ? ALGADESK_EMAIL_TAB_IDS : EMAIL_NOTIFICATION_TAB_IDS');
    expect(source).toContain("...(isAlgadesk ? [] : [{");
    expect(source).toContain("id: 'email-templates'");
  });

  it('hides direct notifications route email-templates tab for Algadesk', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/app/msp/settings/notifications/page.tsx'),
      'utf8',
    );

    expect(source).toContain("const ALGADESK_EMAIL_TAB_IDS = ['settings', 'categories'] as const;");
    expect(source).toContain('const isAlgadesk = productCode === \'algadesk\';');
    expect(source).toContain('isAlgadesk ? ALGADESK_EMAIL_TAB_IDS : EMAIL_NOTIFICATION_TAB_IDS');
    expect(source).toContain("...(isAlgadesk ? [] : [{");
    expect(source).toContain("id: 'email-templates'");
  });
});
