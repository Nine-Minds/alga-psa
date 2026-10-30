import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T084-T087 (RMM signed-in user UI), T145 (merge dialog) and T152 (mobile).
 *
 * Source-level: the first two live in packages with no React mount harness,
 * and `ee/mobile` has no installed node_modules in this repo checkout, so its
 * own vitest project cannot run here (see SCRATCHPAD).
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('RMM signed-in user suggestion row', () => {
  const file = 'packages/assets/src/components/AssetSignedInUserRow.tsx';

  it('T084: shows "Looks like … · Assign" and assigns through the asset action', () => {
    const text = source(file);

    expect(text).toContain("t('assetBento.rmmUser.looksLike'");
    expect(text).toContain('id="asset-rmm-user-assign"');
    expect(text).toMatch(/assignAssetContact\(assetId, suggestion\.contactId\)/);
    // Clicking hides it: the row tracks a dismissal rather than waiting for a
    // refetch that may not come.
    expect(text).toMatch(/const showSuggestion = Boolean\(suggestion\) && !dismissed;/);
  });

  it('T085: offers "Map to contact…" and passes the raw user through', () => {
    const text = source(file);

    expect(text).toContain("t('assetBento.rmmUser.mapToContact'");
    expect(text).toContain('id="asset-rmm-user-map"');
    expect(text).toMatch(/mapRmmUserToContact/);
    expect(text).toMatch(/rawUser: suggestion\.rawUser/);
  });

  it('T086: the suggestion is suppressed for a shared-workspace member', () => {
    // The row renders whatever the suggestion resolver returns, and that
    // returns null for a workspace member — assert it at the source of truth.
    const resolver = source('shared/rmm/signedInUserMappings.ts');

    expect(resolver).toMatch(/'g\.kind': 'shared_workspace'/);
    expect(resolver).toMatch(/if \(workspace\) return null;/);
    expect(source('packages/assets/src/components/AssetSignedInUserRow.tsx'))
      .toMatch(/const showSuggestion = Boolean\(suggestion\)/);
  });

  it('T087: the shared panel shows device count, match method and a saving picker', () => {
    const text = source('packages/integrations/src/components/settings/integrations/RmmUserContactMappingPanel.tsx');

    expect(text).toMatch(/dataIndex: 'deviceCount'/);
    expect(text).toContain("t('integrations.rmm.signedInUsers.columns.method'");
    expect(text).toMatch(/integrations\.rmm\.signedInUsers\.methods\.\$\{method\}/);
    expect(text).toMatch(/id=\{`\$\{idPrefix\}-contact-/);
    expect(text).toMatch(/mapRmmSignedInUserToContact|mapSignedInUserToContact/);
  });
});

describe('merge dialog assets section', () => {
  const file = 'packages/clients/src/components/clients/MergeClientsDialog.tsx';

  it('T145: an Assets step shows the counts and the billing-strategy radio', () => {
    const text = source(file);

    // F096: its own wizard step, between contracts and options.
    expect(text).toMatch(/STEP_ORDER: WizardStep\[\] = \[[^\]]*'assets'/);
    expect(text).toContain('id="merge-assets-section"');
    expect(text).toMatch(/preview\?\.assets\.total/);
    expect(text).toMatch(/preview\?\.assets\.groups/);
    expect(text).toMatch(/preview\?\.assets\.byRmmOrganization/);

    expect(text).toContain('id="merge-billing-strategy"');
    expect(text).toMatch(/id=\{`merge-billing-strategy-\$\{value\}`\}/);
    expect(text).toContain("t('mergeClients.billingStrategyHelp'");
    // F099: source_profile is the default, i.e. today's behaviour.
    expect(text).toMatch(/useState<'source_profile' \| 'target_default'>\('source_profile'\)/);
    // And the choice has to reach the action.
    expect(text).toMatch(/^\s+billingStrategy,$/m);
  });
});

describe('ticket-from-asset requester (FR-E8)', () => {
  it('T123: exactly one option preselects; several offer a choice', () => {
    const action = source('packages/assets/src/actions/assetGroupActions.ts');

    expect(action).toContain('preselect: options.length === 1 ? options[0].contact_name_id : null');

    const button = source('packages/assets/src/components/CreateTicketFromAssetButton.tsx');
    expect(button).toMatch(/getAssetTicketContactOptions\(asset\.asset_id\)/);
    // The options have to be on screen, not only the preselect: a three-person
    // workspace offers three names.
    expect(button).toMatch(/contactOptions\.options\.map\(/);
    expect(button).toContain("id: 'ticket-contact-select'");
    expect(button).toMatch(/\{contactSelectOptions\.length > 0 \?/);
    expect(button).toContain('contact_name_id: contact || contactOptions.preselect || undefined,');
  });

  it('T123: the API path preselects the single option for callers that name nobody', () => {
    // Mobile's ticket modal has no contact field, so the asset's one person is
    // resolved server-side rather than lost.
    const text = source('server/src/lib/api/services/TicketService.ts');

    expect(text).toContain("import { resolveAssetTicketContactOptions } from '@alga-psa/shared/models/assetTicketContactModel';");
    expect(text).toMatch(/if \(!contactNameId\) \{[\s\S]{0,260}if \(options\.length === 1\) contactNameId = options\[0\]\.contact_name_id;/);
    expect(text).toContain('contact_name_id: contactNameId,');
  });

  it('T124: the alert creator prefers the mapping default, then a single workspace user', () => {
    const whole = source('shared/rmm/alerts/resolveContact.ts');
    const text = whole.slice(whole.indexOf('export async function resolveRmmTicketContactId'));

    // Order matters: the mapping default is an explicit operator choice.
    const mappingAt = text.indexOf('nonEmptyString(mappingDefaultContactId)');
    const workspaceAt = text.indexOf('resolveAssetTicketContactOptions');
    expect(mappingAt).toBeGreaterThanOrEqual(0);
    expect(workspaceAt).toBeGreaterThan(mappingAt);
    // Several users is ambiguous and must fall through, not pick arbitrarily.
    expect(text).toMatch(/if \(options\.length === 1\)/);
  });
});

describe('client portal asset surfaces (FR-E7)', () => {
  it('T121: the portal list and detail name the shared workspace', () => {
    // The live list is ClientDevicesPage (routed at /client-portal/devices);
    // asserting a component nothing renders is how this row went missing once.
    const list = source('packages/client-portal/src/components/assets/ClientDevicesPage.tsx');
    const detail = source('packages/client-portal/src/components/assets/AssetDetails.tsx');

    expect(list).toMatch(/record\.group\?\.kind === 'shared_workspace'/);
    expect(list).toContain("t('assets.sharedWorkspace'");
    expect(list).toContain("t('assets.columns.assignedTo'");
    expect(list).toContain("t('assets.unassigned'");
    expect(detail).toContain("t('assets.sharedWorkspaceLabel'");
  });

  it('T030/T121: the portal read supplies the assignee and group those bind to', () => {
    const text = source('packages/client-portal/src/actions/client-portal-actions/client-assets.ts');

    // `assets` stores a contact id and no group, so a bare `assets.*` read
    // renders every device as "Unassigned".
    expect(text).toMatch(/'contacts\.full_name as contact_name'/);
    expect(text).toMatch(/getAssetGroupSummariesForAssets\(\s*trx,\s*tenant,/);
    expect(text).toContain('await getAssetGroupSummary(trx, tenant, assetId)');
    // Every row read goes through the joining helper.
    expect(text).toMatch(/withAssigneeName\(trx, tenant, baseQuery\(\)\)/);
    expect(
      text.match(/withAssigneeName\(trx, tenant, scopedAssets\(trx, tenant, visibility\)\)/g),
    ).toHaveLength(2);
  });

  it('T154: the portal asset picker and ticket creation use the extended filter', () => {
    const text = source('packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');

    // The asset a portal contact files against must pass the same filter the
    // list uses, workspace included, and the check has to happen before the
    // association is written.
    expect(text).toMatch(/applyAssetVisibilityFilter\([\s\S]{0,400}sharedWorkspace: \{ assetIdColumn: 'assets\.asset_id', tenantColumn: 'assets\.tenant' \}/);
    expect(text).toContain("throw expectedClientTicketActionError('Selected asset does not belong to this client')");
  });
});

describe('merge preview asset block (FR-G1)', () => {
  it('T140: the preview counts assets, groups, devices per organization and the unstamped rows', () => {
    const text = source('packages/clients/src/lib/clientMergeEngine.ts');

    const assetsPreview = text.slice(
      text.indexOf('async function readMergeAssetsPreview'),
      text.indexOf('async function readBillingChoicePreview')
    );
    expect(assetsPreview).toMatch(/countRows\(trx, tenant, 'assets', \{ client_id: sourceClientId \}\)/);
    expect(assetsPreview).toMatch(/tableInstalled\(trx, 'asset_groups'\)/);
    expect(assetsPreview).toMatch(/rmm_organization_mappings/);
    expect(assetsPreview).toMatch(/deviceCount/);

    const billingChoice = text.slice(text.indexOf('async function readBillingChoicePreview'));
    // Only the NULLs: an explicit profile is untouched by either strategy.
    expect(billingChoice).toContain("whereNull('billing_profile_id')");
    for (const key of ['unstampedTickets', 'unstampedProjects', 'unstampedAssets', 'unstampedRmmMappings']) {
      expect(billingChoice).toContain(key);
    }
  });
});

describe('mobile asset detail', () => {
  it('T152: renders Assigned to, Manufacturer, Model, Vendor and Group read-only', () => {
    const text = source('ee/mobile/src/screens/AssetDetailScreen.tsx');

    expect(text).toContain('t("identity.assignedTo", "Assigned to")');
    expect(text).toContain('t("identity.unassigned", "Unassigned")');
    expect(text).toContain('t("identity.manufacturer", "Manufacturer")');
    expect(text).toContain('t("identity.model", "Model")');
    expect(text).toContain('t("identity.vendor", "Vendor")');
    expect(text).toContain('t("identity.sharedWorkspace", "Shared workspace")');
    expect(text).toContain('t("identity.bundle", "Bundle")');
    // Read-only: no editing affordance on any of the new rows.
    const identity = text.slice(text.indexOf('identity.assignedTo'), text.indexOf('identity.bundle'));
    expect(identity).not.toMatch(/onPress|TextInput/);
  });

  it('T152: the mobile API type declares the fields those rows read', () => {
    const text = source('ee/mobile/src/api/assets.ts');

    for (const field of ['contact_name', 'manufacturer', 'model', 'vendor_name']) {
      expect(text).toMatch(new RegExp(`${field}\\??:`));
    }
    expect(text).toMatch(/group\?: \{/);
  });

  it('T153: the en mobile locale has the new identity keys', () => {
    const locale = JSON.parse(source('ee/mobile/src/i18n/locales/en/assets.json'));
    const identity = locale.identity;

    for (const key of ['assignedTo', 'unassigned', 'manufacturer', 'model', 'vendor', 'sharedWorkspace', 'bundle']) {
      expect(Object.keys(identity)).toContain(key);
    }
  });
});

describe('status slug never reaches the screen (F021)', () => {
  it('T030: the asset list Coverage cell reads the status through the registry', () => {
    const text = source('packages/assets/src/components/assetListCells.tsx');

    expect(text).toMatch(/assetStatusLabel\(t, asset\.status, statuses\)/);
    // The cell cannot fetch per row, so both lists hand it the registry they
    // already hold.
    expect(source('packages/assets/src/components/AssetDashboardClient.tsx'))
      .toMatch(/<AssetCoverageCell asset=\{record\} now=\{Date\.now\(\)\} statuses=\{assetStatuses\} \/>/);
    expect(source('packages/msp-composition/src/clients/MspClientAssets.tsx'))
      .toMatch(/<AssetCoverageCell asset=\{record\} now=\{Date\.now\(\)\} statuses=\{assetStatuses\} \/>/);
  });

  it('T030: the contact Assets tile and the printable header resolve the label too', () => {
    expect(source('packages/assets/src/components/ContactAssetsSection.tsx'))
      .toMatch(/assetStatusLabel\(t, row\.asset_status, assetStatuses\)/);
    expect(source('packages/assets/src/components/AssetDetailView.tsx'))
      .toMatch(/assetStatusLabel\(t, asset\.status, assetStatuses\)/);
  });

  it('T030: the drawer summary grid shows the same label as its badge', () => {
    const text = source('packages/assets/src/components/AssetDetailDrawerClient.tsx');

    expect(text).toMatch(/statusLabel: translateStatus\(asset\.status\)/);
    expect(text).toMatch(/statusLabel=\{statusLabel\}/);
  });

  it('T030: the portal and mobile read-only surfaces humanize the slug', () => {
    // One helper, two surfaces: the list used to call every slug that was not
    // `inactive` "Active" while the details panel named it correctly.
    const helper = source('packages/client-portal/src/components/assets/portalAssetStatus.ts');
    expect(helper).toMatch(/assets\.statuses\.\$\{status\}/);
    expect(helper).toMatch(/assetStatusLabelForSlug\(status, null\)/);

    const detail = source('packages/client-portal/src/components/assets/AssetDetails.tsx');
    // The caller hands down the tenant's label and kind when it knows them,
    // so a renamed status reads the same in the dialog as in the row.
    expect(detail).toMatch(/portalAssetStatusLabel\(t, asset\.status, statusLabel\)/);
    expect(detail).toMatch(/portalAssetStatusVariant\(asset\.status, statusKind\)/);
    // Badge renders a div; a div inside a p is the hydration error the portal
    // details panel used to log.
    expect(detail).not.toMatch(/<p className="mt-1">\s*\{?\s*<Badge/);

    const list = source('packages/client-portal/src/components/assets/ClientDevicesPage.tsx');
    expect(list).toMatch(/portalAssetStatusLabel\(t, slug, slug \? statusBySlug\.get\(slug\)\?\.label : undefined\)/);
    expect(list).toMatch(/portalAssetStatusVariant\(value, statusBySlug\.get\(value\)\?\.kind\)/);
    expect(list).not.toMatch(/devices\.status\.inactive/);

    const portalLocale = JSON.parse(source('server/public/locales/en/client-portal.json'));
    expect(Object.keys(portalLocale.assets.statuses)).toEqual([
      'active', 'in_stock', 'maintenance', 'inactive', 'retired',
    ]);

    expect(source('ee/mobile/src/screens/AssetDetailScreen.tsx'))
      .toMatch(/<Badge label=\{humanizeStatus\(asset\.status\)\} \/>/);
  });
});
