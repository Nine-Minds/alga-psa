// LEVERAGE: friction client-url-website-dual-storage — this compatibility
// boundary keeps partial updates safe while both legacy website columns exist.
/**
 * Merge partial client updates while keeping the legacy url column and the
 * properties.website value synchronized only when one was explicitly sent.
 */
export function mergeClientWebsiteUpdate<T extends { url?: string | null; properties?: Record<string, unknown> | null }>(
  currentUrl: string | null | undefined,
  currentProperties: Record<string, unknown> | null | undefined,
  update: T
): { url?: string; properties?: Record<string, unknown> } {
  const hasUrl = Object.prototype.hasOwnProperty.call(update, 'url');
  const hasProperties = Object.prototype.hasOwnProperty.call(update, 'properties') && update.properties != null;
  const incomingProperties = update.properties ?? {};
  const hasWebsite = hasProperties && Object.prototype.hasOwnProperty.call(incomingProperties, 'website');
  const properties = { ...(currentProperties ?? {}), ...(hasProperties ? incomingProperties : {}) };

  if (!hasWebsite && !hasUrl) {
    return hasProperties ? { properties } : {};
  }

  // properties.website is the canonical UI field if both values disagree.
  const website = hasWebsite ? incomingProperties.website : update.url;
  const normalizedWebsite = website == null ? '' : String(website);
  properties.website = normalizedWebsite;
  return { url: normalizedWebsite, properties };
}

export function clientWebsiteFieldsForSave<T extends {
  url?: string | null;
  properties?: Record<string, unknown> | null;
}>(edited: T, original: T): { changed: boolean; url?: string; website?: unknown } {
  // Compare the effective form value. The website input can synchronize `url`
  // while loading, which is not a user edit when properties.website is intact.
  const effectiveWebsite = (client: T) => {
    if (client.properties && Object.prototype.hasOwnProperty.call(client.properties, 'website')) {
      return client.properties.website ?? '';
    }
    return client.url ?? '';
  };
  const editedWebsite = effectiveWebsite(edited);
  const changed = editedWebsite !== effectiveWebsite(original);
  if (!changed) return { changed: false };
  return {
    changed: true,
    url: editedWebsite == null ? '' : String(editedWebsite),
    website: editedWebsite,
  };
}
