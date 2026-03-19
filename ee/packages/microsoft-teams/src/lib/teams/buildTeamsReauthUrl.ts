export function buildTeamsReauthPath(callbackUrl: string): string {
  const params = new URLSearchParams({
    callbackUrl,
    teamsReauth: '1',
  });

  return `/auth/msp/signin?${params.toString()}`;
}

export function buildTeamsReauthUrl(origin: string, callbackUrl: string): URL {
  return new URL(buildTeamsReauthPath(callbackUrl), origin);
}
