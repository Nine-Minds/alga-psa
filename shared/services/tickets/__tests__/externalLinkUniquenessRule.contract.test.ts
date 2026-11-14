import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_LINK_IDENTITY_RELATIONSHIPS,
  EXTERNAL_LINK_RELATIONSHIPS,
} from '@alga-psa/types';

/**
 * One uniqueness rule, two expressions: the partial unique indexes on external_entity_links and the
 * application pre-check (`assertNoLinkConflict`, driven by EXTERNAL_LINK_IDENTITY_RELATIONSHIPS). This
 * pins the migration's index predicates to the constant so the two cannot drift.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../server/migrations');
const RULE_MIGRATION = '20261109120000_ticket_template_links.cjs';
const INDEXES = ['external_entity_links_external_unique', 'external_entity_links_reference_unique'];

function upSection(file: string): string {
  const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  return source.split('exports.down')[0];
}

function indexPredicate(sql: string, indexName: string): string {
  const match = new RegExp(`CREATE UNIQUE INDEX[^;]*?${indexName}[\\s\\S]*?WHERE ([^\\n\`]+)`).exec(sql);
  if (!match) throw new Error(`${indexName} has no partial predicate in ${RULE_MIGRATION}`);
  return match[1].trim();
}

const quotedValues = (predicate: string) => [...predicate.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe('external link uniqueness rule (migration ↔ code)', () => {
  const up = upSection(RULE_MIGRATION);

  it('the identity index covers exactly the identity relationships', () => {
    const predicate = indexPredicate(up, 'external_entity_links_external_unique');
    expect(predicate).toMatch(/^relationship IN \(/);
    expect(new Set(quotedValues(predicate))).toEqual(new Set(EXTERNAL_LINK_IDENTITY_RELATIONSHIPS));
  });

  it('the per-entity index covers exactly the remaining (citation) relationships', () => {
    const predicate = indexPredicate(up, 'external_entity_links_reference_unique');
    const citations = EXTERNAL_LINK_RELATIONSHIPS.filter(
      (r) => !(EXTERNAL_LINK_IDENTITY_RELATIONSHIPS as readonly string[]).includes(r)
    );
    expect(new Set(quotedValues(predicate))).toEqual(new Set(citations));
  });

  it('no later migration redefines these indexes without updating this contract', () => {
    const later = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.cjs') && file > RULE_MIGRATION)
      .filter((file) => INDEXES.some((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').includes(name)));
    expect(later).toEqual([]);
  });
});
