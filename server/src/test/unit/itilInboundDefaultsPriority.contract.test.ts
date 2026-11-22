import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T042 — F019 and the wiring half of F018 of `ee/plans/2026-11-21-itil-remediation`
 * (`email-hotfix`).
 *
 * The inbound-defaults strings are new, so every locale has to carry them: one missing key leaves
 * an admin reading a raw translation id at the moment their email routing is misconfigured. The
 * fall-back wiring is asserted on the source because the behaviour it delegates to is covered by
 * `inboundTicketDefaultsPriorityBoard.integration.test.ts`; what can silently regress is the call
 * itself, or its policy flipping to `refuse` and dropping emails.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LOCALES_DIR = path.resolve(REPO_ROOT, 'server/public/locales');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

function at(value: any, dottedPath: string): unknown {
  return dottedPath.split('.').reduce((node, key) => (node == null ? node : node[key]), value);
}

const NEW_KEYS: Array<{ namespace: string; key: string }> = [
  { namespace: 'msp/email-providers', key: 'inboundDefaultsForm.validation.priorityBoardMismatch' },
  { namespace: 'msp/email-providers', key: 'inboundDefaultsForm.validation.priorityMissing' },
  { namespace: 'msp/email-providers', key: 'errors.inboundDefaults.priorityNotValidForBoard' },
  { namespace: 'msp/admin', key: 'inboundDefaults.badges.priorityNotOnBoard' },
];

const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('inbound defaults priority strings', () => {
  it('T042: every locale, including the pseudo-locales, carries each new key', () => {
    expect(locales).toContain('en');
    expect(locales.length).toBeGreaterThanOrEqual(10);

    for (const locale of locales) {
      for (const { namespace, key } of NEW_KEYS) {
        const file = path.resolve(LOCALES_DIR, locale, `${namespace}.json`);
        const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
        const value = at(bundle, key);
        expect(typeof value, `${locale}/${namespace} ${key}`).toBe('string');
        expect((value as string).trim().length, `${locale}/${namespace} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('T042: no new string is left as an untranslated copy of the English one', () => {
    const english = Object.fromEntries(
      NEW_KEYS.map(({ namespace, key }) => [
        `${namespace}:${key}`,
        at(JSON.parse(fs.readFileSync(path.resolve(LOCALES_DIR, 'en', `${namespace}.json`), 'utf8')), key),
      ])
    );

    for (const locale of locales.filter((name) => !['en', 'xx', 'yy'].includes(name))) {
      for (const { namespace, key } of NEW_KEYS) {
        const bundle = JSON.parse(
          fs.readFileSync(path.resolve(LOCALES_DIR, locale, `${namespace}.json`), 'utf8')
        );
        expect(at(bundle, key), `${locale}/${namespace} ${key}`).not.toBe(english[`${namespace}:${key}`]);
      }
    }
  });

  it('F019: the new controls carry kebab-case ids', () => {
    expect(source('packages/integrations/src/components/email/forms/InboundTicketDefaultsForm.tsx')).toContain(
      'id="priority-board-mismatch-warning"'
    );
    expect(source('packages/integrations/src/components/email/admin/InboundTicketDefaultsManager.tsx')).toContain(
      'id={`inbound-defaults-priority-mismatch-${defaultConfig.id}`}'
    );
  });
});

describe('inbound email priority wiring', () => {
  it('F018: createTicketFromEmail resolves its priority with the fall-back policy', () => {
    const text = source('shared/workflow/actions/emailWorkflowActions.ts');
    expect(text).toContain("import { resolveTicketPriorityFields } from '../../lib/tickets/boardFieldRules'");

    const call = text.slice(text.indexOf('const resolved = await resolveTicketPriorityFields('));
    expect(call.slice(0, 400)).toContain("policy: 'fallback'");
    // The resolved value, not the configured one, reaches the create.
    expect(text).toContain('priority_id: priorityId,');
  });

  it('F016: both inbound-defaults writes check the priority against the board', () => {
    const text = source('packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions.ts');
    expect(text).toContain("import { findBoardFieldProblems } from '@alga-psa/shared/lib/tickets/boardFieldRules'");
    expect(text.match(/await assertPriorityFitsBoard\(/g) ?? []).toHaveLength(2);
  });
});
