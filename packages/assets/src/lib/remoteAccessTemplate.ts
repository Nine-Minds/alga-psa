export interface RemoteAccessTemplateContext {
  asset: Record<string, unknown>;
  client: Record<string, unknown>;
  field?: Record<string, unknown> | null;
}

const PLACEHOLDER_PATTERN = /\{(asset|client|field)\.([a-zA-Z0-9_-]+)\}/g;

/** Templates must contain an explicit scheme and a literal, valid host. */
export function hasLiteralHttpAuthority(template: string): boolean {
  const normalizedTemplate = template.trim();
  const match = normalizedTemplate.match(/^(https?):\/\/([^/?#]*)/i);
  if (!match) return false;
  const [, scheme, authority] = match;
  if (!authority || /[{}\\\s]/.test(authority)) return false;
  try {
    const url = new URL(`${scheme}://${authority}/`);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

/** Renders an operator-authored URL template with encoded values and safe schemes. */
export function renderRemoteAccessTemplate(
  template: string,
  context: RemoteAccessTemplateContext
): string | null {
  const normalizedTemplate = template.trim();
  if (!hasLiteralHttpAuthority(normalizedTemplate)) return null;

  let hasMissingValue = false;
  const rendered = normalizedTemplate.replace(PLACEHOLDER_PATTERN, (_token, scope: string, key: string) => {
    const isSupportedAssetKey = scope !== 'asset' || ['name', 'asset_tag', 'serial_number'].includes(key);
    const isSupportedClientKey = scope !== 'client' || key === 'name';
    if (!isSupportedAssetKey || !isSupportedClientKey) {
      hasMissingValue = true;
      return '';
    }
    const values = scope === 'field'
      ? context.field
      : context[scope as 'asset' | 'client'];
    const value = values?.[key];
    if (value === null || typeof value === 'undefined' || String(value) === '') {
      hasMissingValue = true;
      return '';
    }
    return encodeURIComponent(String(value));
  });

  if (hasMissingValue || /[{}]/.test(rendered)) return null;
  try {
    const url = new URL(rendered);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
