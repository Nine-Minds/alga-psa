export function appendPortalDomain(path: string, portalDomain?: string | null): string {
  if (!portalDomain) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}portalDomain=${encodeURIComponent(portalDomain)}`;
}

export function buildPasswordResetLink(
  baseUrl: string | undefined,
  token: string,
  portal: 'msp' | 'client',
  portalDomain?: string
): string {
  const resetLink = `${baseUrl}/auth/password-reset/set-new-password?token=${encodeURIComponent(token)}&portal=${portal}`;
  return appendPortalDomain(resetLink, portalDomain);
}
