import type { SetAttribute } from '../querySchema';

/**
 * Set attribute over `tag_mappings`: the element value is the tag definition id
 * (`tag_mappings.tag_id` = `tag_definitions.tag_id`), never the tag text or the mapping id.
 */
export const tagSet = (options: { taggedType: string; local: string }): SetAttribute => ({
  kind: 'set',
  table: 'tag_mappings',
  local: options.local,
  foreign: 'tagged_id',
  valueColumn: 'tag_id',
  valueType: 'uuid',
  where: { tagged_type: options.taggedType },
});
