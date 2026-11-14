import { describe, expect, it } from 'vitest';
import { aclPredicateSql, type SearchAclPrincipal } from './acl';

// F077 in the search index: a principal the kernel narrows to external audiences reads client and public articles only.
const principal = (audienceReader: SearchAclPrincipal['audienceReader']): SearchAclPrincipal => ({
  userId: 'u', tenant: 't', permissions: ['kb:read'], isInternal: true, clientAccess: { mode: 'all' }, audienceReader,
});
const clause = `(object_type <> 'kb_article' OR metadata->>'audience' = ANY(?::text[]))`;

describe('knowledge base audience in the search ACL predicate', () => {
  it('owning-tenant staff (and a principal with no reader set) are not narrowed', () => {
    expect(aclPredicateSql(principal({ kind: 'staff', tenant: 't' })).sql).not.toContain('kb_article');
    expect(aclPredicateSql(principal(undefined)).sql).not.toContain('kb_article');
  });

  it('a seat technician is held to the external audiences, and a seat with no live assignment too', () => {
    for (const reader of [{ kind: 'seat', tenant: 't', clientId: 'c' } as any, null]) {
      const { sql, bindings } = aclPredicateSql(principal(reader));
      expect(sql).toContain(clause);
      expect(bindings).toContainEqual(['client', 'public']);
    }
  });
});
