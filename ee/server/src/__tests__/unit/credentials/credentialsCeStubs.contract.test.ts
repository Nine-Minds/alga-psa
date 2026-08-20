import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('credentials vault — CE stub contracts', () => {
  it('CE stubs render null for every vault component', () => {
    const stubs = [
      'packages/ee/src/components/credentials/CredentialsScreen.tsx',
      'packages/ee/src/components/credentials/CredentialFormDialog.tsx',
      'packages/ee/src/components/credentials/CredentialRestrictDialog.tsx',
      'packages/ee/src/components/credentials/CredentialLinkDialog.tsx',
      'packages/ee/src/components/credentials/ClientCredentialsTab.tsx',
      'packages/ee/src/components/credentials/AssetCredentialsSection.tsx',
      'packages/ee/src/components/credentials/EntityCredentialsSection.tsx',
    ];
    for (const stub of stubs) {
      const source = readRepoFile(stub);
      expect(source).toContain('CE stub');
      expect(source).toMatch(/return null;/);
    }
  });

  it('CE action stubs throw ENTERPRISE_EDITION_REQUIRED and the context probe returns hidden', () => {
    const stub = readRepoFile('packages/ee/src/lib/actions/credentials/credentialActions.ts');

    expect(stub).toContain("code: 'ENTERPRISE_EDITION_REQUIRED'");
    expect(stub).toContain('getCredentialsContext');
    expect(stub).toContain(
      "return { tierOk: false, huduConnected: false, state: 'unavailable', flagIrrelevantHere: true };"
    );
    for (const action of [
      'listCredentials',
      'createCredential',
      'updateCredential',
      'deleteCredential',
      'revealCredential',
      'revealCredentialOtpSeed',
      'setCredentialRestriction',
      'addCredentialToEntity',
      'removeCredentialFromEntity',
      'setEntityCredentials',
    ]) {
      expect(stub).toContain(`export async function ${action}`);
    }
  });

  it('EE action barrel and CE stub export the same names (edition parity)', () => {
    const ee = readRepoFile('ee/server/src/lib/actions/credentials/credentialActions.ts');
    const ce = readRepoFile('packages/ee/src/lib/actions/credentials/credentialActions.ts');

    const eeExports = [...ee.matchAll(/^export (?:async )?(?:const|function) (\w+)/gm)].map((m) => m[1]);
    const ceExports = [...ce.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);

    // Every EE action must have a CE counterpart.
    for (const name of eeExports) {
      expect(ceExports, `CE stub missing export ${name}`).toContain(name);
    }
  });

  it('the /msp/credentials page resolves the screen through @enterprise (CE renders null)', () => {
    const page = readRepoFile('server/src/app/msp/credentials/page.tsx');
    expect(page).toContain("@enterprise/components/credentials/CredentialsScreen");
  });

  it('the credentials tier feature is EE-agnostic and gated to pro+ (types constant)', () => {
    const tierSource = readRepoFile('packages/types/src/constants/tierFeatures.ts');
    expect(tierSource).toContain("CREDENTIALS = 'CREDENTIALS'");
    expect(tierSource).toContain("[TIER_FEATURES.CREDENTIALS]: 'pro'");
  });
});

describe('credentials vault — flag-off legacy Hudu tab preservation', () => {
  it('ClientDetails still registers the legacy Hudu-only Passwords tab when the vault gate is off', () => {
    const source = readRepoFile(
      'packages/clients/src/components/clients/ClientDetails.tsx'
    );

    // The unified vault tab replaces the legacy pair only when the vault gate is
    // visible; otherwise the exact legacy registration survives.
    expect(source).toContain('credentialsVaultTab.visible');
    expect(source).toContain('<ClientCredentialsTab clientId={client.client_id} />');
    expect(source).toContain('<HuduClientPasswordsTab clientId={client.client_id} />');
    expect(source).toContain("id: 'hudu-passwords'");

    // Both registrations sit in the same tab-array position: vault-first, legacy fallback.
    const vaultIdx = source.indexOf('credentialsVaultTab.visible');
    const huduLegacyIdx = source.indexOf("id: 'hudu-passwords'");
    expect(vaultIdx).toBeGreaterThan(-1);
    expect(huduLegacyIdx).toBeGreaterThan(vaultIdx);

    // The legacy Hudu tab content is byte-identical to the pre-vault wiring
    // (the same clientId prop is forwarded to the Hudu-only tab).
    const huduPasswordsSection = source.slice(huduLegacyIdx, huduLegacyIdx + 400);
    expect(huduPasswordsSection).toContain('<HuduClientPasswordsTab clientId={client.client_id} />');
  });

  it('the asset section preserves the legacy placeholder when the flag is off and the vault card when on', () => {
    const wrapper = readRepoFile(
      'packages/assets/src/components/tabs/AssetCredentialsSection.tsx'
    );
    const tab = readRepoFile('packages/assets/src/components/tabs/DocumentsPasswordsTab.tsx');
    const eeSection = readRepoFile(
      'ee/server/src/components/credentials/AssetCredentialsSection.tsx'
    );
    const eeGenericSection = readRepoFile(
      'ee/server/src/components/credentials/EntityCredentialsSection.tsx'
    );

    // Shared wrapper: flag-gated. Flag off => the legacy placeholder card
    // renders in both EE and CE builds; flag on => the vault section loads via
    // @enterprise (EE renders the card, CE renders nothing).
    expect(wrapper).toContain("useFeatureFlag('release-v1-5-feature'");
    expect(wrapper).toContain('if (!flagEnabled) {');
    expect(wrapper).toContain("t('documentsPasswordsTab.passwords.title'");
    expect(wrapper).toContain("t('documentsPasswordsTab.passwords.comingSoon'");
    expect(wrapper).toContain('Secure password management coming soon.');
    expect(wrapper).toContain(
      "import('@enterprise/components/credentials/AssetCredentialsSection')"
    );
    expect(wrapper).toContain('<VaultAssetCredentialsSection assetId={assetId} clientId={clientId} />');

    // The tab wires the section; no placeholder text lives in the tab itself.
    expect(tab).toContain('<AssetCredentialsSection assetId={asset.asset_id} clientId={asset.client_id} />');
    expect(tab).not.toContain('coming soon');
    expect(tab).not.toContain('Secure password management coming soon');

    // The EE asset section is the generic entity section scoped to the asset;
    // the GENERIC section gates its Card + header on the flag (flag off =>
    // null, never an empty title-only card) and derives the asset ids.
    expect(eeSection).toContain('EntityCredentialsSection');
    expect(eeSection).toContain('entityType="asset"');
    expect(eeGenericSection).toContain("useFeatureFlag('release-v1-5-feature'");
    expect(eeGenericSection).toContain('if (!flagEnabled) {');
    expect(eeGenericSection).toContain('return null;');
    expect(eeGenericSection).toContain('id={cardId}');
    expect(eeGenericSection).toContain('`${entityType}-credentials-section`');
  });

  it('the client gate requires the release flag, EE, and the tier probe (useCredentialsVaultTab)', () => {
    const hook = readRepoFile('packages/clients/src/components/clients/useCredentialsVaultTab.ts');
    expect(hook).toContain("isEnterprise");
    expect(hook).toContain("useFeatureFlag('release-v1-5-feature'");
    expect(hook).toContain("getCredentialsContext");
    expect(hook).toContain('visible: enabled && flagEnabled && tierOk');
  });

  it('the global screen renders nothing when the release flag is off (flag gate in component)', () => {
    const screen = readRepoFile(
      'ee/server/src/components/credentials/CredentialsScreen.tsx'
    );
    expect(screen).toContain("useFeatureFlag('release-v1-5-feature'");
    expect(screen).toContain('if (!flagEnabled) {');
    expect(screen).toContain('return null;');
  });

  it('the sidebar hides the Passwords nav item when the release flag is off', () => {
    const sidebar = readRepoFile('server/src/components/layout/SidebarWithFeatureFlags.tsx');
    const menuConfig = readRepoFile('server/src/config/menuConfig.ts');

    expect(sidebar).toContain("useFeatureFlag('release-v1-5-feature'");
    expect(sidebar).toContain("item.name !== 'Passwords' || credentialsVaultEnabled");
    // The nav item itself is tier+edition gated (hidden on CE and below pro).
    expect(menuConfig).toContain("name: 'Passwords'");
    expect(menuConfig).toContain('requiredFeature: TIER_FEATURES.CREDENTIALS');
    expect(menuConfig).toContain('availableEditions: ENTERPRISE_ONLY_EDITIONS');
  });
});
