import { describe, expect, it } from 'vitest';
import {
  collectUnmappedQuickBooksEntities,
  findQuickBooksNameConflict,
  proposeQuickBooksName,
  validateQuickBooksMappingDecisions
} from '../../src/actions/quickBooksExportMappingRules';

const errors = [
  {
    code: 'missing_client_mapping',
    resolution_state: 'open',
    metadata: { alga_entity_type: 'client', alga_entity_id: 'client-1', alga_name: 'Acme Corporation International Holdings LLC' }
  },
  {
    code: 'missing_service_mapping',
    resolution_state: 'open',
    metadata: { alga_entity_type: 'service', alga_entity_id: 'svc-1', alga_name: 'Dell 16: Laptop', item_kind: 'product' }
  },
  {
    code: 'missing_service_mapping',
    resolution_state: 'open',
    metadata: { alga_entity_type: 'service', alga_entity_id: 'svc-1', alga_name: 'Dell 16: Laptop', item_kind: 'product' }
  },
  { code: 'missing_service_mapping', resolution_state: 'resolved', metadata: { service_id: 'svc-old', service_name: 'Old' } },
  { code: 'missing_discount_mapping', resolution_state: 'open', metadata: {} },
  { code: 'missing_tax_mapping', resolution_state: 'open', metadata: { tax_region: 'CA' } }
];

describe('collectUnmappedQuickBooksEntities', () => {
  it('lists each open unmapped client, service/product and discount once with a QuickBooks-safe proposed name', () => {
    const entities = collectUnmappedQuickBooksEntities('quickbooks_desktop', errors);

    expect(entities).toEqual([
      expect.objectContaining({ algaEntityType: 'client', algaEntityId: 'client-1', maxNameLength: 41, proposedName: 'Acme Corporation International Holdings L' }),
      expect.objectContaining({ algaEntityType: 'service', algaEntityId: 'svc-1', itemKind: 'product', maxNameLength: 31, proposedName: 'Dell 16- Laptop' }),
      expect.objectContaining({ algaEntityType: 'discount', algaEntityId: 'automatic_discount', algaName: 'Discount' })
    ]);
  });

  it('uses QuickBooks Online name limits for CSV batches', () => {
    const [client] = collectUnmappedQuickBooksEntities('quickbooks_csv', errors);
    expect(client.maxNameLength).toBe(100);
    expect(client.proposedName).toBe('Acme Corporation International Holdings LLC');
  });

  it('accepts legacy service errors that only carry service_id and service_name', () => {
    const [entity] = collectUnmappedQuickBooksEntities('quickbooks_desktop', [
      { code: 'missing_service_mapping', resolution_state: 'open', metadata: { service_id: 'svc-9', service_name: 'Backup' } }
    ]);
    expect(entity).toMatchObject({ algaEntityType: 'service', algaEntityId: 'svc-9', algaName: 'Backup' });
  });
});

describe('proposeQuickBooksName', () => {
  it('strips separators, sub-list colons and quotes', () => {
    expect(proposeQuickBooksName('  Managed\tBackup: "Gold"\n', 31)).toBe("Managed Backup- 'Gold'");
  });
});

describe('validateQuickBooksMappingDecisions', () => {
  const pending = collectUnmappedQuickBooksEntities('quickbooks_desktop', errors);

  it('accepts a decision per pending entity', () => {
    expect(
      validateQuickBooksMappingDecisions('quickbooks_desktop', pending, [
        { algaEntityType: 'client', algaEntityId: 'client-1', externalName: 'Acme Corp', mode: 'existing' },
        { algaEntityType: 'service', algaEntityId: 'svc-1', externalName: 'Dell 16 Laptop', mode: 'create' }
      ])
    ).toBeNull();
  });

  it('rejects entities that are not unmapped for this batch', () => {
    expect(
      validateQuickBooksMappingDecisions('quickbooks_desktop', pending, [
        { algaEntityType: 'service', algaEntityId: 'svc-other', externalName: 'X', mode: 'create' }
      ])
    ).toMatchObject({ key: 'errors.accountingExport.quickbooksMapping.stale' });
  });

  it('rejects empty, over-long and separator-bearing names', () => {
    const decide = (externalName: string) =>
      validateQuickBooksMappingDecisions('quickbooks_desktop', pending, [
        { algaEntityType: 'service', algaEntityId: 'svc-1', externalName, mode: 'create' }
      ]);
    expect(decide('  ')).toMatchObject({ key: 'errors.accountingExport.quickbooksMapping.nameRequired', params: { algaName: 'Dell 16: Laptop' } });
    expect(decide('x'.repeat(32))).toMatchObject({ key: 'errors.accountingExport.quickbooksMapping.nameTooLong', params: { maxLength: 31 } });
    expect(decide('Bad\tName')).toMatchObject({ key: 'errors.accountingExport.quickbooksMapping.nameInvalidCharacters' });
    expect(decide('Hardware:Laptops')).toBeNull();
  });

  it('rejects two new entries with the same name in one list but allows a customer and item to share a name', () => {
    const twoItems = collectUnmappedQuickBooksEntities('quickbooks_desktop', [
      ...errors,
      { code: 'missing_service_mapping', resolution_state: 'open', metadata: { alga_entity_id: 'svc-2', alga_name: 'Dell 16 Laptop' } }
    ]);
    expect(
      validateQuickBooksMappingDecisions('quickbooks_desktop', twoItems, [
        { algaEntityType: 'service', algaEntityId: 'svc-1', externalName: 'Laptop', mode: 'create' },
        { algaEntityType: 'service', algaEntityId: 'svc-2', externalName: 'laptop', mode: 'create' }
      ])
    ).toMatchObject({ key: 'errors.accountingExport.quickbooksMapping.duplicateNewName', params: { qbName: 'laptop' } });
    expect(
      validateQuickBooksMappingDecisions('quickbooks_desktop', twoItems, [
        { algaEntityType: 'client', algaEntityId: 'client-1', externalName: 'Acme', mode: 'create' },
        { algaEntityType: 'service', algaEntityId: 'svc-1', externalName: 'Acme', mode: 'create' }
      ])
    ).toBeNull();
  });

  it('rejects linking two CSV entities to the same QuickBooks name, but lets Desktop services share an item', () => {
    const extra = { code: 'missing_service_mapping', resolution_state: 'open', metadata: { alga_entity_id: 'svc-2', alga_name: 'Dell 16 Laptop 2' } };
    const decisions = [
      { algaEntityType: 'service' as const, algaEntityId: 'svc-1', externalName: 'Laptop', mode: 'existing' as const },
      { algaEntityType: 'service' as const, algaEntityId: 'svc-2', externalName: 'Laptop', mode: 'existing' as const }
    ];
    const csvItems = collectUnmappedQuickBooksEntities('quickbooks_csv', [...errors, extra]);
    expect(validateQuickBooksMappingDecisions('quickbooks_csv', csvItems, decisions))
      .toMatchObject({ key: 'errors.accountingExport.quickbooksMapping.duplicateItemName', params: { qbName: 'Laptop' } });

    // A Desktop item name is mapping metadata; the mapped value is the account, which services share.
    const desktopItems = collectUnmappedQuickBooksEntities('quickbooks_desktop', [...errors, extra]);
    expect(validateQuickBooksMappingDecisions('quickbooks_desktop', desktopItems, decisions)).toBeNull();
  });

  it('carries an existing Desktop account so the prompt completes that mapping in place', () => {
    const [entity] = collectUnmappedQuickBooksEntities('quickbooks_desktop', [
      { code: 'missing_service_mapping', resolution_state: 'open', metadata: { alga_entity_id: 'svc-9', alga_name: 'Backup', desktop_account: 'Backup Income', desktop_mapping_source: 'service' } }
    ]);
    expect(entity).toMatchObject({ desktopAccount: 'Backup Income', desktopMappingInPlace: true });

    const [viaCategory] = collectUnmappedQuickBooksEntities('quickbooks_desktop', [
      { code: 'missing_service_mapping', resolution_state: 'open', metadata: { alga_entity_id: 'svc-9', alga_name: 'Backup', desktop_account: 'Backup Income', desktop_mapping_source: 'service_category' } }
    ]);
    expect(viaCategory).toMatchObject({ desktopAccount: 'Backup Income', desktopMappingInPlace: false });
  });
});

describe('findQuickBooksNameConflict', () => {
  const pending = collectUnmappedQuickBooksEntities('quickbooks_desktop', errors);
  const stored = (type: string) => (type === 'discount' ? 'discount' : type);

  it('ignores Desktop item names, which are not the mapped value', () => {
    expect(
      findQuickBooksNameConflict(
        pending,
        [{ algaEntityType: 'service', algaEntityId: 'svc-1', externalName: 'Laptop', mode: 'existing' }],
        [{ alga_entity_type: 'service', alga_entity_id: 'svc-other', external_entity_id: 'Laptop' }],
        stored,
        'quickbooks_desktop'
      )
    ).toBeNull();
  });

  it('reports a name already mapped to a different entity of the same type', () => {
    expect(
      findQuickBooksNameConflict(
        pending,
        [{ algaEntityType: 'service', algaEntityId: 'svc-1', externalName: 'Laptop', mode: 'existing' }],
        [{ alga_entity_type: 'service', alga_entity_id: 'svc-other', external_entity_id: 'Laptop' }],
        stored
      )
    ).toMatchObject({
      key: 'errors.accountingExport.quickbooksMapping.nameTakenByItem',
      params: { qbName: 'Laptop', algaName: 'Dell 16: Laptop' },
      message: expect.stringMatching(/already mapped to another item/)
    });
  });

  it('ignores the same entity, other entity types, and other names', () => {
    expect(
      findQuickBooksNameConflict(
        pending,
        [{ algaEntityType: 'service', algaEntityId: 'svc-1', externalName: 'Laptop', mode: 'existing' }],
        [
          { alga_entity_type: 'service', alga_entity_id: 'svc-1', external_entity_id: 'Laptop' },
          { alga_entity_type: 'client', alga_entity_id: 'client-9', external_entity_id: 'Laptop' },
          { alga_entity_type: 'service', alga_entity_id: 'svc-9', external_entity_id: 'Desktop' }
        ],
        stored
      )
    ).toBeNull();
  });
});
