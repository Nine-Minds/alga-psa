import { isLicensedUserType } from '@alga-psa/types';
import type { IDisplayTag, ITagDisplayRule, TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';

/** Entity types a display rule can be written for. */
export const TAG_DISPLAY_ENTITY_TYPES: readonly TagDisplayEntityType[] = ['contact', 'client'];
export const TAG_DISPLAY_AUDIENCES: readonly TagDisplayAudience[] = ['internal', 'client'];

export const isTagDisplayEntityType = (value: unknown): value is TagDisplayEntityType =>
  value === 'contact' || value === 'client';
export const isTagDisplayAudience = (value: unknown): value is TagDisplayAudience =>
  value === 'internal' || value === 'client';

/**
 * The audience a user sees chips as. Only an internal (MSP) user gets the internal rules; anything
 * else, including an unknown type, is treated as a client so a missing value can never widen what is
 * shown.
 */
export function displayAudienceForUser(user: { user_type?: string | null } | null | undefined): TagDisplayAudience {
  return isLicensedUserType(user?.user_type) ? 'internal' : 'client';
}

/**
 * Pure resolver: the tags to show for one entity. `rules` are the rules for this entity type and
 * audience (any order; `position` decides), `entityTags` is everything the entity is tagged with
 * (definition ids). Result follows rule order and contains only ruled tags. No rules, no tags.
 */
export function resolveDisplayedTags(
  rules: readonly Pick<ITagDisplayRule, 'tag_id' | 'position'>[],
  entityTags: readonly IDisplayTag[],
): IDisplayTag[] {
  if (rules.length === 0 || entityTags.length === 0) return [];
  const byId = new Map(entityTags.map((tag) => [tag.tag_id, tag]));
  return [...rules]
    .sort((a, b) => a.position - b.position)
    .map((rule) => byId.get(rule.tag_id))
    .filter((tag): tag is IDisplayTag => tag !== undefined);
}
