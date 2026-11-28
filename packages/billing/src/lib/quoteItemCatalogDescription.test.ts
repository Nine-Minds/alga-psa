import { describe, expect, it } from 'vitest';
import {
  normalizeCatalogDescription,
  resolveCatalogDescriptionWrite,
} from './quoteItemCatalogDescription';

describe('normalizeCatalogDescription', () => {
  it.each([
    ['  text  ', 'text'],
    ['', null],
    ['   \n\t ', null],
    [null, null],
    [undefined, null],
    [42, null],
    ['line one\nline two', 'line one\nline two'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeCatalogDescription(input)).toBe(expected);
  });
});

describe('resolveCatalogDescriptionWrite truth table', () => {
  const CATALOG = 'Central management and monitoring.';

  it.each([
    // [caller, catalog, expected text, expected edited]
    ['Edited wording', CATALOG, 'Edited wording', true],
    [CATALOG, CATALOG, CATALOG, false],
    [`  ${CATALOG}  `, CATALOG, CATALOG, false],
    [CATALOG, `  ${CATALOG}\n`, CATALOG, false],
    ['', CATALOG, null, true],
    ['   ', CATALOG, null, true],
    [null, CATALOG, null, true],
    ['', '', null, false],
    [null, null, null, false],
    ['', '   ', null, false],
    [null, undefined, null, false],
    ['Edited wording', null, 'Edited wording', true],
    ['Edited wording', '', 'Edited wording', true],
    ['central management and monitoring.', CATALOG, 'central management and monitoring.', true],
  ])('caller %j vs catalog %j', (caller, catalog, text, edited) => {
    expect(resolveCatalogDescriptionWrite(caller, catalog)).toEqual({
      catalog_description: text,
      catalog_description_edited: edited,
    });
  });
});
