import { describe, expect, it } from 'vitest';

import { buildTsvectorSql } from '@alga-psa/search/sql';

describe('search SQL helpers', () => {
  it('T021 builds weighted tsvector SQL using process_large_lexemes', () => {
    const fragment = buildTsvectorSql('Title', 'Subtitle', 'Body');

    expect(fragment.sql).toContain('public.process_large_lexemes(');
    expect(fragment.sql).toContain("setweight(public.process_large_lexemes(?), 'A')");
    expect(fragment.sql).toContain("setweight(public.process_large_lexemes(?), 'B')");
    expect(fragment.sql).toContain("setweight(public.process_large_lexemes(?), 'C')");
    expect(fragment.sql).toContain(' || ');
    expect(fragment.bindings).toEqual(['Title', 'Subtitle', 'Body']);
  });
});
