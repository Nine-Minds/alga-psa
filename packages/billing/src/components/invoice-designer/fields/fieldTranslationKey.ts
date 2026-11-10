/**
 * The i18n key for a designer field's label or description: `designer.fields.<binding path>.<part>`,
 * with the path's dots as underscores so the key stays one level deep under `designer.fields`.
 */
export const designerFieldTranslationKey = (path: string, part: 'label' | 'description'): string =>
  `designer.fields.${path.replace(/\./g, '_')}.${part}`;
