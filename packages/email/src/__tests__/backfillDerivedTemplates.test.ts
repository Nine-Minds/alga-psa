import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOCK_EMAIL_PALETTE, applyEmailPalette, brandDecorator, resolveEmailPalette } from '../branding';
import { templateSnapshotHash } from '../derivedTemplates';
import { fakeTenantDb, quoteBody } from './helpers/quoteTemplateFixtures';

const enterprise = vi.hoisted(() => ({ value: true }));
vi.mock('@alga-psa/core/features', () => ({ get isEnterprise() { return enterprise.value; } }));

// The backfill reads through the tenantDb facade; hand it the in-memory one.
const facade = vi.hoisted(() => ({ current: null as any }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => facade.current }));

const { backfillDerivedTemplatesForTenant, matchDerivedRow } = await import('../backfillDerivedTemplates');
const { PRIOR_SYSTEM_BODIES } = await import('../priorSystemBodies.generated');
const { lookupEmailTemplate } = await import('../templateLookup');

const here = path.dirname(fileURLToPath(import.meta.url));
const TARGET = resolveEmailPalette({ primary: '#aa2200', secondary: '#112233' });
const BRANDING = { logoUrl: '/logo.png', clientName: 'RightPath' };
const OLD = quoteBody('quoteEmail', 'en', false);
const NEW = quoteBody('quoteEmail', 'en', true);
const brand = {
  palette: { primary: '#aa2200', secondary: '#112233', logo: { variant: 'default' as const }, appliedPalette: TARGET },
  branding: BRANDING,
};

/** What "Apply to templates" wrote for a system body: palette, then logo/attribution. */
function writtenByApply(body: typeof OLD) {
  const decorate = brandDecorator({ logo: { variant: 'default' } }, BRANDING, true, TARGET)!;
  return { ...body, html_content: decorate(applyEmailPalette(body.html_content, STOCK_EMAIL_PALETTE, TARGET)) };
}

const knexStub = { transaction: (fn: (trx: unknown) => unknown) => fn({ raw: (_sql: string, bindings: [string, string]) => ({ __jsonbSet: bindings }) }) } as any;

function world(tenantRows: any[]) {
  const data = {
    system_email_templates: [
      { id: 7, name: 'quote-email', language_code: 'en', ...NEW },
      { id: 8, name: 'quote-reminder-email', language_code: 'en', ...quoteBody('quoteReminder', 'en', true) },
    ],
    tenant_email_templates: tenantRows,
    tenant_settings: [{ settings: { emailBranding: brand.palette, branding: BRANDING } }],
  };
  facade.current = fakeTenantDb(data);
  return data;
}

describe('prior-body catalogue', () => {
  it('is exactly what the template modules render, never hand-copied', () => {
    const generator = createRequire(import.meta.url)(path.resolve(here, '../../../../server/scripts/generate-prior-email-template-bodies.cjs'));
    expect(JSON.parse(JSON.stringify(PRIOR_SYSTEM_BODIES))).toEqual(generator.buildCatalogue());
  });

  it('holds the bodies from before the review link for both quote emails, in every language', () => {
    expect(Object.keys(PRIOR_SYSTEM_BODIES).sort()).toEqual(['quote-email', 'quote-reminder-email']);
    expect(Object.keys(PRIOR_SYSTEM_BODIES['quote-email']).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv']);
    expect(PRIOR_SYSTEM_BODIES['quote-email'].en[0].html_content).toBe(OLD.html_content);
  });
});

describe('matchDerivedRow', () => {
  const system = { id: 7, name: 'quote-email', language_code: 'en', ...NEW };
  const row = (over: object = {}) => ({ id: 1, name: 'quote-email', language_code: 'en', ...writtenByApply(OLD), ...over });
  const prior = PRIOR_SYSTEM_BODIES['quote-email'].en;

  it('recognises a branded copy of a prior body', () => {
    expect(matchDerivedRow(row(), system, prior, [TARGET, STOCK_EMAIL_PALETTE], brand as any)).toMatchObject({ matchedBody: prior[0].label, palette: TARGET });
  });

  it('recognises a branded copy of the current body', () => {
    const current = row({ ...writtenByApply(NEW) });
    expect(matchDerivedRow(current, system, prior, [TARGET], brand as any)?.matchedBody).toBe('current');
  });

  it('recognises an untouched clone in stock colors with the palette tried second', () => {
    const clone = row({ ...OLD });
    expect(matchDerivedRow(clone, system, prior, [TARGET, STOCK_EMAIL_PALETTE], brand as any)?.palette).toEqual(STOCK_EMAIL_PALETTE);
  });

  it('matches the row with or without the logo the brand adds', () => {
    const bare = row({ html_content: applyEmailPalette(OLD.html_content, STOCK_EMAIL_PALETTE, TARGET) });
    expect(matchDerivedRow(bare, system, prior, [TARGET], brand as any)).not.toBeNull();
  });

  it.each([
    ['edited text in the html', { html_content: writtenByApply(OLD).html_content.replace('Quote', 'Offer') }],
    ['edited subject', { subject: 'My own subject' }],
    ['edited plain text', { text_content: 'my own text' }],
  ])('matches nothing when the tenant %s', (_label, change) => {
    expect(matchDerivedRow(row(change), system, prior, [TARGET, STOCK_EMAIL_PALETTE], brand as any)).toBeNull();
  });
});

describe('backfillDerivedTemplatesForTenant', () => {
  beforeEach(() => { enterprise.value = true; });

  const rightPath = () => ({ id: 1, name: 'quote-email', language_code: 'en', ...writtenByApply(OLD) });
  const edited = () => ({ id: 2, name: 'quote-reminder-email', language_code: 'en', ...writtenByApply(quoteBody('quoteReminder', 'en', false)), subject: 'Our own reminder subject' });

  it('stamps the RightPath-shaped row, after which the resolver serves the current body with the review link', async () => {
    const data = world([rightPath()]);
    const storedHtml = data.tenant_email_templates[0].html_content;

    const summary = await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1');

    expect(summary.stamped).toEqual([{ name: 'quote-email', language: 'en', matchedBody: expect.any(String) }]);
    expect(data.tenant_email_templates[0]).toMatchObject({
      derived_from_system_id: 7,
      derived_palette: TARGET,
      derived_snapshot_hash: templateSnapshotHash(rightPath()),
      html_content: storedHtml,
    });
    const found = await lookupEmailTemplate(facade.current, 'quote-email', 'en');
    expect(found?.source).toBe('tenant-derived');
    expect(found!.template.html_content).toContain('quoteReviewLink');
    expect(found!.template.html_content).toContain('#aa2200');
  });

  it('leaves rows that match nothing exactly as they were and counts them', async () => {
    const data = world([edited()]);
    const before = JSON.stringify(data.tenant_email_templates);

    const summary = await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1');

    expect(summary).toMatchObject({ considered: 1, stamped: [], unmatched: 1 });
    expect(JSON.stringify(data.tenant_email_templates)).toBe(before);
  });

  it('never touches a row that already carries provenance', async () => {
    const stamped = { ...rightPath(), derived_from_system_id: 99, derived_palette: TARGET, derived_snapshot_hash: 'abc' };
    const data = world([stamped]);
    const summary = await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1');
    expect(summary.considered).toBe(0);
    expect(data.tenant_email_templates[0].derived_from_system_id).toBe(99);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const data = world([rightPath(), edited()]);
    await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1');
    const afterFirst = JSON.stringify(data.tenant_email_templates);

    const second = await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1', { force: true });

    expect(second.stamped).toEqual([]);
    expect(JSON.stringify(data.tenant_email_templates)).toBe(afterFirst);
  });

  it('writes nothing on a dry run but reports what it would stamp', async () => {
    const data = world([rightPath()]);
    const summary = await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1', { dryRun: true });
    expect(summary.stamped).toHaveLength(1);
    expect(data.tenant_email_templates[0].derived_snapshot_hash).toBeUndefined();
    expect(data.tenant_settings[0].settings).not.toHaveProperty('emailTemplateProvenanceBackfill');
  });

  it('marks a finished tenant and skips it on the next run unless forced', async () => {
    const data = world([rightPath()]);
    await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1');
    expect((data.tenant_settings[0].settings as any).emailTemplateProvenanceBackfill).toMatchObject({ considered: 1, stamped: 1, unmatched: 0 });

    data.tenant_email_templates.push({ ...rightPath(), id: 5, name: 'quote-email', language_code: 'en' });
    expect((await backfillDerivedTemplatesForTenant(knexStub, 'tenant-1')).skipped).toBe('already-run');
    expect(data.tenant_email_templates[1].derived_snapshot_hash).toBeUndefined();
  });
});
