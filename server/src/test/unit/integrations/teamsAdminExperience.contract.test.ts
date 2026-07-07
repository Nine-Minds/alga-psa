import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readLocaleSettings(locale: string): any {
  const json = JSON.parse(readRepoFile(`server/public/locales/${locale}/msp/integrations.json`));
  return json.integrations.teams.settings;
}

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

const COMPONENT = 'packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx';
const TEAMS_DIR = 'packages/integrations/src/components/settings/integrations/teams';

describe('Teams production-readiness admin experience (E6/E7) contracts', () => {
  it('F053: guided setup wizard renders a stepper with kebab-case ids and gates activation on profile validation', () => {
    const source = readRepoFile(COMPONENT);
    expect(source).toContain('id="teams-setup-wizard"');
    expect(source).toContain('id={`teams-wizard-step-${step.id}`}');
    expect(source).toContain('id="teams-validate-profile"');
    expect(source).toContain('id="teams-probe-permissions"');
    expect(source).toContain('id="teams-validate-bot"');
    expect(source).toContain('id="teams-wizard-activate"');
    // Activation is blocked until live profile validation passes.
    expect(source).toContain('disabled={saving || !canPersist || !profileValidated}');
    expect(source).toContain("const profileValidated = profileValidation?.status === 'ok'");
    // Wizard only renders while the integration is not yet active.
    expect(source).toContain("const showWizard = Boolean(teamsStatus?.success) && !isActive");
  });

  it('F058: wizard steps link to the runbook via the shared anchor module', () => {
    const source = readRepoFile(COMPONENT);
    const runbook = readRepoFile(`${TEAMS_DIR}/teamsRunbook.ts`);
    expect(source).toContain("import { teamsRunbookHref, type TeamsRunbookSection } from './teams/teamsRunbook'");
    for (const anchor of [
      '#1-create-the-entra-app-registration',
      '#2-grant-graph-application-permissions',
      '#3-register-the-azure-bot-and-set-bot-credentials',
      '#5-generate-and-upload-the-teams-app-package',
      '#7-verify',
    ]) {
      expect(runbook, `runbook module should reference ${anchor}`).toContain(anchor);
    }
  });

  it('F059: stale-manifest warning is derived client-side and cleared by regeneration', () => {
    const source = readRepoFile(COMPONENT);
    const warning = readRepoFile(`${TEAMS_DIR}/TeamsStaleManifestWarning.tsx`);
    expect(warning).toContain('id="teams-stale-manifest-warning"');
    expect(source).toContain('<TeamsStaleManifestWarning');
    expect(source).toContain('const packageStale =');
    // Freshly generated package (this session) wins so regeneration clears the warning.
    expect(source).toContain('packageStatus?.baseUrl');
    expect(source).toContain('onRegenerate={() => void handlePackageRefresh()}');
  });

  it('F060/F061: delivery + audit viewers and their delegators are wired', () => {
    const barrel = readRepoFile('packages/integrations/src/actions/integrations/teamsActions.ts');
    expect(barrel).toContain('export const listTeamsDeliveries = withAuth(');
    expect(barrel).toContain('export const listTeamsAuditEvents = withAuth(');
    expect(barrel).toContain('actions.listTeamsDeliveriesImpl(user, { tenant }, params)');
    expect(barrel).toContain('actions.listTeamsAuditEventsImpl(user, { tenant }, params)');

    const delivery = readRepoFile(`${TEAMS_DIR}/TeamsDeliveryLogViewer.tsx`);
    expect(delivery).toContain('id="teams-delivery-log-viewer"');
    expect(delivery).toContain('id="teams-delivery-status-filter"');
    expect(delivery).toContain('id="teams-delivery-category-filter"');

    const audit = readRepoFile(`${TEAMS_DIR}/TeamsAuditLogViewer.tsx`);
    expect(audit).toContain('id="teams-audit-log-viewer"');
    expect(audit).toContain('id="teams-audit-surface-filter"');
    expect(audit).toContain('id="teams-audit-action-filter"');
  });

  it('F062: troubleshooting panel covers the full delivery error-code union', () => {
    const recorder = readRepoFile('ee/packages/microsoft-teams/src/lib/notifications/teamsDeliveryRecorder.ts');
    const union = [...(recorder.match(/export type TeamsDeliveryErrorCode =([\s\S]*?);/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const panel = readRepoFile(`${TEAMS_DIR}/TeamsTroubleshootingPanel.tsx`);
    const remedies = readRepoFile(`${TEAMS_DIR}/teamsTroubleshooting.ts`);
    expect(panel).toContain('id="teams-troubleshooting-panel"');
    expect(union.length).toBeGreaterThan(0);
    for (const code of union) {
      expect(remedies, `remedy map should include ${code}`).toContain(`${code}:`);
    }
  });

  it('F063/F064/F065: validation delegators, paywall, and expired banner are wired', () => {
    const barrel = readRepoFile('packages/integrations/src/actions/integrations/teamsActions.ts');
    expect(barrel).toContain('export const validateTeamsGraphCredentials = withAuth(');
    expect(barrel).toContain('export const probeTeamsGraphPermissions = withAuth(');
    expect(barrel).toContain('export const validateTeamsBotConnector = withAuth(');
    expect(barrel).toContain('export const getTeamsAddonPurchaseAccess = withAuth(');
    expect(barrel).toContain("hasPermission(user as any, 'billing', 'update')");

    const eeIndex = readRepoFile('ee/packages/microsoft-teams/src/actions/index.ts');
    expect(eeIndex).toContain("export * from '../lib/actions/integrations/teamsSetupValidationActions'");

    const paywall = readRepoFile(`${TEAMS_DIR}/TeamsPaywallCard.tsx`);
    expect(paywall).toContain('id="teams-paywall-card"');
    expect(paywall).toContain('id="teams-paywall-purchase"');
    expect(paywall).toContain("'/msp/account'");

    const banner = readRepoFile(`${TEAMS_DIR}/TeamsAddonExpiredBanner.tsx`);
    expect(banner).toContain('id="teams-addon-expired-banner"');

    const component = readRepoFile(COMPONENT);
    expect(component).toContain("isAddonAbsent");
    expect(component).toContain("const isAddonExpired = addOnState === 'expired'");
    expect(component).toContain('<TeamsAddonExpiredBanner />');
    expect(component).toContain('<TeamsPaywallCard />');
  });

  it('E6/E7: every new admin i18n sub-tree is present in all ten locales', () => {
    const subtrees = ['wizard', 'runbook', 'deliveryLog', 'auditLog', 'troubleshooting', 'paywall', 'addonExpiredBanner', 'staleManifest'];
    for (const locale of LOCALES) {
      const settings = readLocaleSettings(locale);
      for (const subtree of subtrees) {
        expect(settings[subtree], `${locale} missing settings.${subtree}`).toBeTruthy();
      }
      expect(typeof settings.paywall.cta, `${locale} paywall.cta`).toBe('string');
      expect(typeof settings.deliveryLog.title, `${locale} deliveryLog.title`).toBe('string');
      expect(typeof settings.troubleshooting.codes.graph_unauthorized.remedy, `${locale} remedy`).toBe('string');
    }
  });
});
