import { describe, expect, it } from 'vitest';
import { findSourceBoundaryViolations } from '../../../../scripts/lib/source-boundary';

// Source snippets are inputs to the validator, not assertions about repository
// implementation text. Exercise its accept/reject behavior for metadata and code.
const rules = [
  { name: 'protected table reference', regex: /\bsensitive_records\b/ },
  { name: 'protected module import', regex: /from\s*['"]@protected\// },
];
const validate = (source: string) => findSourceBoundaryViolations(source, rules, ['CATALOG']);

describe('source boundary metadata validation', () => {
  it('accepts nested literal metadata in a named const declaration', () => {
    expect(validate(`
      export const CATALOG: readonly Entry[] = ([{
        table: 'sensitive_records',
        flags: [true, false, null, -1, 2],
        child: { sensitive_records: 'combined schema' },
      }] as const) satisfies readonly Entry[];
    `)).toEqual([]);
  });

  it('still rejects a query next to an accepted metadata declaration', () => {
    expect(validate(`
      export const CATALOG = [{ table: 'sensitive_records' }];
      export function read(db) { return db.table('sensitive_records'); }
    `)).toEqual(['protected table reference']);
  });

  it('still rejects protected imports in a metadata module', () => {
    expect(validate(`
      import { read } from '@protected/records';
      export const CATALOG = [{ table: 'sensitive_records' }];
    `)).toEqual(['protected module import']);
  });

  it.each([
    "db.table('sensitive_records')",
    "[{ table: 'sensitive_records', value: load() }]",
    "{ get sensitive_records() { return load(); } }",
    "{ sensitive_records() { return load(); } }",
    "{ sensitive_records: externalValue }",
    "{ sensitive_records: 'data', ...externalValue }",
    "['sensitive_records', ...externalValue]",
    "{ [computeKey()]: 'sensitive_records' }",
    '`sensitive_records ${load()}`',
  ])('rejects executable or state-dependent metadata: %s', initializer => {
    expect(validate(`export const CATALOG = ${initializer};`)).toEqual(['protected table reference']);
  });

  it('does not exempt mutable, nested or unregistered declarations', () => {
    for (const source of [
      "export let CATALOG = ['sensitive_records'];",
      "function read() { const CATALOG = ['sensitive_records']; }",
      "export const OTHER_CATALOG = ['sensitive_records'];",
      "export const CATALOG = [], OTHER_CATALOG = ['sensitive_records'];",
    ]) {
      expect(validate(source)).toEqual(['protected table reference']);
    }
  });

  it('checks all declarations and surrounding code without executing the input', () => {
    expect(validate(`
      const CATALOG = ['sensitive_records'];
      throw new Error('validation must not execute source');
      import { read } from '@protected/records';
    `)).toEqual(['protected module import']);
  });
});
