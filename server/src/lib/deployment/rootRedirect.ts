import logger from '@alga-psa/core/logger';

export type RootRedirectTarget = '/client-portal/dashboard' | '/msp/dashboard';

export async function resolveRootRedirect(args: {
  hostname: string;
  hostHeader: string;
  canonicalHostname: string | null;
  lookupPortalDomain: (candidate: string) => Promise<unknown | null>;
}): Promise<RootRedirectTarget> {
  const { hostname, hostHeader, canonicalHostname, lookupPortalDomain } = args;

  if (canonicalHostname && hostname === canonicalHostname) {
    return '/msp/dashboard';
  }

  const [, port] = hostHeader.split(':');
  const hostCandidates = [hostname];
  if (port && port !== '80' && port !== '443') {
    hostCandidates.unshift(hostHeader);
  }

  try {
    for (const candidate of hostCandidates) {
      if (await lookupPortalDomain(candidate)) {
        return '/client-portal/dashboard';
      }
    }
  } catch (error) {
    logger.warn('Failed to resolve root redirect for request host', {
      hostname,
      error,
    });
  }

  return '/msp/dashboard';
}
