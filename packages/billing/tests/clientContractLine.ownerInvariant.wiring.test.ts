import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const billingSource = readFileSync(
  new URL('../src/models/clientContractLine.ts', import.meta.url),
  'utf8'
);
const clientsSource = readFileSync(
  new URL('../../clients/src/models/clientContractLine.ts', import.meta.url),
  'utf8'
);

const getSection = (source: string, start: string, end: string) => {
  const [, tail = ''] = source.split(start);
  const [section = ''] = tail.split(end);
  return section;
};

describe('client contract line owner invariant wiring', () => {
  it('T047: overlap helpers join contracts and enforce owner_client_id for contract-derived conflicts', () => {
    const billingOverlapSection = getSection(billingSource, 'static async checkOverlappingBilling(', 'static async create(');
    const clientsOverlapSection = getSection(clientsSource, 'static async checkOverlappingBilling(', 'static async create(');

    for (const source of [billingOverlapSection, clientsOverlapSection]) {
      expect(source).toContain(".join('contracts as c'");
      expect(source).toContain("'c.owner_client_id': clientId");
      expect(source).toContain(".andWhere(function()");
      expect(source).toContain("this.whereNull('c.is_template').orWhere('c.is_template', false);");
    }
  });

  it('T048: client contract line listings filter contract-backed rows by the owning client invariant', () => {
    const billingListingSection = getSection(billingSource, 'static async getByClientId(', 'static async getById(');
    const clientsListingSection = getSection(clientsSource, 'static async getByClientId(', 'static async get(');

    for (const source of [billingListingSection, clientsListingSection]) {
      expect(source).toContain(".join('contracts as c'");
      expect(source).toContain("'c.owner_client_id': clientId");
      expect(source).toContain("this.whereNull('c.is_template').orWhere('c.is_template', false);");
    }
  });
});
