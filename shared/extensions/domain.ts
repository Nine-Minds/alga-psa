export function computeDomain(tenantId: string, registryId: string, root?: string): string {
  const rootDomain = (root || process.env.EXT_DOMAIN_ROOT || '').trim();
  if (!rootDomain) throw new Error('EXT_DOMAIN_ROOT not configured');
  const slug = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const norm = (s: string) => (/^[0-9a-f]{8}-/.test(s) ? s.replace(/-/g, '').slice(0, 8) : s.replace(/-/g, '').slice(0, 12));
  const t = norm(slug(tenantId));
  const e = norm(slug(registryId));
  const label = `${t}-${e}`;
  return `${label}.${rootDomain}`;
}

export function normalizeLabel(label: string): string {
  const [left, right] = label.includes('--') ? label.split('--', 2) : label.split('-', 2);
  const short = (s: string) => (/^[0-9a-f]{8}/.test(s) ? s.replace(/-/g, '').slice(0, 8) : s.replace(/-/g, '').slice(0, 12));
  return `${short(left || '')}-${short(right || '')}`;
}

