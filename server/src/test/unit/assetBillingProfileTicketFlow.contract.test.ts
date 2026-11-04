import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T126 / T128 / T130 / T131 / T132 — F088/F089: `assets.billing_profile_id`
 * has to reach the tickets raised from the asset, on every surface, and has to
 * be cleared when the asset's client changes.
 *
 * Source-level because the call chain spans five packages and the behaviour is
 * "which module is wired to which", which is exactly what regressed: the
 * resolver existed but only the alert-ticket creator called it, so the column
 * influenced nothing on MSP, portal or mobile. The second miss was narrower —
 * `createTicketFromAsset` inherited, but the asset detail header, asset list,
 * service history and maintenance dialogs all create through `addTicket` with
 * an `asset_id`, which did not.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('asset billing profile reaches tickets from assets', () => {
  it('T130: the shared model inherits the asset profile for every surface', () => {
    const text = source('shared/models/ticketModel.ts');

    expect(text).toContain("import { resolveAssetBillingProfileId } from './assetBillingProfileModel';");
    // An explicit pick wins; omitted inherits. `??` and not `||`, so an
    // explicit null still falls through to the asset rather than staying null.
    expect(text).toMatch(
      /const billingProfileId = validatedData\.billing_profile_id\s*\n?\s*\?\? await resolveAssetBillingProfileId\(trx, tenant, validatedData\.asset_id\);/
    );
    expect(text).toContain('billing_profile_id: billingProfileId,');
    // And the field must survive the parse that precedes it.
    expect(text).toMatch(/createTicketFromAssetSchema = z\.object\(\{[\s\S]*?billing_profile_id: z\.string\(\)\.guid\(/);
  });

  it('T130: the MSP and REST edge schemas carry the field through', () => {
    expect(source('packages/tickets/src/schemas/ticket.schema.ts'))
      .toMatch(/createTicketFromAssetSchema = z\.object\(\{[\s\S]*?billing_profile_id: z\.string\(\)\.guid\(\)\.nullable\(\)\.optional\(\)/);
    expect(source('server/src/lib/api/schemas/ticket.ts'))
      .toMatch(/createTicketFromAssetSchema = z\.object\(\{[\s\S]*?billing_profile_id: uuidSchema\.nullable\(\)\.optional\(\)/);
    // The REST service must forward it rather than dropping it on the floor.
    expect(source('server/src/lib/api/services/TicketService.ts'))
      .toContain('billing_profile_id: data.billing_profile_id ?? null');
  });

  it('T130: addTicket inherits the asset profile for the QuickAddTicket surfaces', () => {
    const text = source('packages/tickets/src/actions/ticketActions.ts');

    // The asset header, asset list, service history and maintenance dialogs all
    // create through addTicket with an asset_id — not createTicketFromAsset —
    // so without this the retained profile reached no ticket at all.
    expect(text).toContain(
      "import { resolveAssetBillingProfileIdForClient } from '@alga-psa/shared/models/assetBillingProfileModel';"
    );
    expect(text).toMatch(
      /if \(linkedAssetIds\.length > 0 && createTicketInput\.client_id && !createTicketInput\.billing_profile_id\) \{\s*\n\s*createTicketInput\.billing_profile_id =\s*\n\s*\(await resolveAssetBillingProfileIdForClient\(\s*\n\s*trx,\s*\n\s*tenant,\s*\n\s*linkedAssetIds\[0\],/
    );
    // With several assets the profile resolves from the first linked one, and
    // the single `asset_id` ("opened from an asset") is always placed first.
    expect(text).toMatch(
      /const linkedAssetIds = Array\.from\(\s*\n\s*new Set\(\[\.\.\.\(asset_id \? \[asset_id as string\] : \[\]\), \.\.\.extras\.assetIds\]\)/
    );
  });

  it('T130: the portal prefers the asset profile over the contact heuristic', () => {
    const text = source('packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');

    expect(text).toContain("import { resolveAssetBillingProfileId } from '@shared/models/assetBillingProfileModel';");
    expect(text).toMatch(
      /const assetBillingProfileId = validatedData\.asset_id\s*\n?\s*\? await resolveAssetBillingProfileId\(trx, tenant, validatedData\.asset_id\)/
    );
    expect(text).toContain('billing_profile_id: assetBillingProfileId ?? contactBillingProfileId,');
  });

  it('T128: the alert-ticket creator prefers the mapping profile, then the asset', () => {
    const text = source('shared/rmm/alerts/ticketCreator.ts');

    expect(text).toContain("resolveAssetBillingProfileId,\n} from '../../models/assetBillingProfileModel';");
    // Guarded by assetId, so an alert with no asset passes nothing (T129).
    expect(text).toMatch(/params\.assetId\s*\?\s*await profileForClient\(/);
    expect(text).toContain('await resolveAssetBillingProfileId(trx, tenantId, params.assetId)');
    // Each candidate is checked against the ticket's client: FR-G5 lets a
    // device be moved by hand, so a mapping may still name the old client.
    expect(text).toContain('assertBillingProfileForClient');
    expect(text).toContain('profileForClient(trx, tenantId, params.clientId, params.mappingBillingProfileId ?? null)');
  });

  it('T126: AssetForm clears the billing profile when the client changes', () => {
    const text = source('packages/assets/src/components/AssetForm.tsx');

    const handler = text.slice(
      text.indexOf('const handleClientChange'),
      text.indexOf('const handleLocationSelect')
    );
    expect(handler).toContain('contact_name_id: null');
    // Without this the save fails validation instead of moving the device.
    expect(handler).toContain('billing_profile_id: null');
  });

  it('T131: AssetForm only offers the select when the client has several profiles', () => {
    const text = source('packages/assets/src/components/AssetForm.tsx');

    expect(text).toContain('{billingProfiles.length > 1 ? (');
    expect(text).toContain("id=\"asset-billing-profile-select\"");
  });
});
