const { __transformAst } = require('../20260923110000_add_quote_section_title_bindings_to_grouped_catalog.cjs');

describe('grouped quote section title catalog migration', () => {
  const ast = {
    bindings: { values: { title: { id: 'title', kind: 'value', path: 'title' } }, collections: {} },
    layout: {
      id: 'root', type: 'document', children: [
        { id: 'monthly-section-label', type: 'text', content: { type: 'i18n', i18nKey: 'labels.monthlyItems', defaultValue: 'Monthly Items' } },
        { id: 'onetime-section-label', type: 'text', content: { type: 'i18n', i18nKey: 'labels.oneTimeItems', defaultValue: 'One-time Items' } },
        { id: 'monthly-section-label-custom', type: 'text', content: { type: 'literal', value: 'Retainer' } },
        { id: 'onetime-section-label', type: 'text', content: { type: 'literal', value: 'Custom wording' } },
      ],
    },
  };

  it('is idempotent and changes only the two untouched default expressions', () => {
    const once = __transformAst(ast, 'up');
    expect(__transformAst(once, 'up')).toEqual(once);
    expect(once.layout.children[0].content).toEqual({
      type: 'binding', bindingId: 'recurringSectionTitle',
      fallback: { i18nKey: 'labels.monthlyItems', defaultValue: 'Monthly Items' },
    });
    expect(once.layout.children[1].content.bindingId).toBe('onetimeSectionTitle');
    expect(once.bindings.values).toEqual({
      title: { id: 'title', kind: 'value', path: 'title' },
      recurringSectionTitle: { id: 'recurringSectionTitle', kind: 'value', path: 'recurring_section_title' },
      onetimeSectionTitle: { id: 'onetimeSectionTitle', kind: 'value', path: 'onetime_section_title' },
    });
    expect(once.layout.children[2].content).toEqual({ type: 'literal', value: 'Retainer' });
    expect(once.layout.children[3].content).toEqual({ type: 'literal', value: 'Custom wording' });
  });

  it('reverses only migrated expressions', () => {
    expect(__transformAst(__transformAst(ast, 'up'), 'down')).toEqual(ast);
  });

  it('reverses migrated expressions when JSONB key order differs', () => {
    const migrated = __transformAst(ast, 'up');
    const reordered = JSON.parse(JSON.stringify(migrated));
    reordered.bindings.values.recurringSectionTitle = { path: 'recurring_section_title', kind: 'value', id: 'recurringSectionTitle' };
    reordered.bindings.values.onetimeSectionTitle = { path: 'onetime_section_title', kind: 'value', id: 'onetimeSectionTitle' };
    reordered.layout.children[0].content = {
      fallback: { defaultValue: 'Monthly Items', i18nKey: 'labels.monthlyItems' },
      bindingId: 'recurringSectionTitle',
      type: 'binding',
    };
    reordered.layout.children[1].content = {
      fallback: { defaultValue: 'One-time Items', i18nKey: 'labels.oneTimeItems' },
      bindingId: 'onetimeSectionTitle',
      type: 'binding',
    };

    const rolledBack = __transformAst(reordered, 'down');
    expect(rolledBack.bindings.values).not.toHaveProperty('recurringSectionTitle');
    expect(rolledBack.bindings.values).not.toHaveProperty('onetimeSectionTitle');
    expect(rolledBack.layout.children[0].content).toEqual({ type: 'i18n', i18nKey: 'labels.monthlyItems', defaultValue: 'Monthly Items' });
    expect(rolledBack.layout.children[1].content).toEqual({ type: 'i18n', i18nKey: 'labels.oneTimeItems', defaultValue: 'One-time Items' });
  });

  it('preserves preexisting custom value bindings on up and down', () => {
    const custom = {
      ...ast,
      bindings: { ...ast.bindings, values: { ...ast.bindings.values, recurringSectionTitle: { id: 'recurringSectionTitle', kind: 'value', path: 'custom_path' } } },
    };
    expect(__transformAst(__transformAst(custom, 'up'), 'down').bindings.values.recurringSectionTitle.path).toBe('custom_path');
  });
});
