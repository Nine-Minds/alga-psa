import { describe, expect, it } from 'vitest';
import { COMPONENT_CATALOG } from './componentCatalog';

describe('componentCatalog', () => {
  it('uses unit price binding for default rate column', () => {
    const table = COMPONENT_CATALOG.find((component) => component.type === 'table');
    const columns = (table?.defaultMetadata?.columns as Array<Record<string, unknown>> | undefined) ?? [];
    const rateColumn = columns.find((column) => column.id === 'col-rate');

    expect(rateColumn?.key).toBe('item.unitPrice');
  });
});
