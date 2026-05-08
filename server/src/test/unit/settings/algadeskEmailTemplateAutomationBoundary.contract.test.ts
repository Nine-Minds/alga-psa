import fs from 'fs';
import path from 'path';

describe('AlgaDesk email template automation boundary', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  it('hides notifications email-templates tab in main settings notifications composition for AlgaDesk', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/components/settings/general/NotificationsTab.tsx'),
      'utf8',
    );

    expect(source).toContain("const ALGA_DESK_EMAIL_TAB_IDS = ['settings', 'categories', 'telemetry'] as const;");
    expect(source).toContain('const isAlgaDesk = productCode === \'algadesk\';');
    expect(source).toContain('isAlgaDesk ? ALGA_DESK_EMAIL_TAB_IDS : EMAIL_NOTIFICATION_TAB_IDS');
    expect(source).toContain("...(isAlgaDesk ? [] : [{");
    expect(source).toContain("id: 'email-templates'");
  });

  it('hides direct notifications route email-templates tab for AlgaDesk', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/app/msp/settings/notifications/page.tsx'),
      'utf8',
    );

    expect(source).toContain("const ALGA_DESK_EMAIL_TAB_IDS = ['settings', 'categories'] as const;");
    expect(source).toContain('const isAlgaDesk = productCode === \'algadesk\';');
    expect(source).toContain('isAlgaDesk ? ALGA_DESK_EMAIL_TAB_IDS : EMAIL_NOTIFICATION_TAB_IDS');
    expect(source).toContain("...(isAlgaDesk ? [] : [{");
    expect(source).toContain("id: 'email-templates'");
  });
});
