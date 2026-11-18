import { describe, expect, it } from 'vitest';

import { validateTemplateAst } from '../invoice-template-ast/schema';

import { STANDARD_LABEL_TEMPLATE_ASTS, LABEL_CLASS_BY_STANDARD_CODE } from './standardTemplates';

/**
 * The builders build their ASTs from typed node objects, but the ASTs still have to satisfy the
 * runtime zod schema the designer and the save path validate against. This pins that every standard
 * label template passes that schema, so a builder edit that emits a key the schema does not allow
 * (or drops one it requires) fails here instead of at a tenant's save click.
 */
describe('standard label template ASTs conform to the template AST schema', () => {
  const codes = Object.keys(STANDARD_LABEL_TEMPLATE_ASTS);

  it('covers every standard code the class map knows', () => {
    expect(new Set(codes)).toEqual(new Set(Object.keys(LABEL_CLASS_BY_STANDARD_CODE)));
  });

  it.each(codes)('%s validates against templateAstSchema', (code) => {
    const result = validateTemplateAst(STANDARD_LABEL_TEMPLATE_ASTS[code]);
    if (!result.success) {
      const detail = result.errors.map((error) => `${error.path || '<root>'}: ${error.message}`).join('; ');
      throw new Error(`${code} failed schema validation: ${detail}`);
    }
    expect(result.ast).toBeDefined();
  });
});
