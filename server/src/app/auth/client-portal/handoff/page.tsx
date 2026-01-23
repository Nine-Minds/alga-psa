import { PortalSessionHandoff } from '@alga-psa/auth/client';

function buildFallbackLoginUrl(): string {
  const authUrl = process.env.NEXTAUTH_URL;

  if (!authUrl) {
    return '/auth/client-portal/signin';
  }

  try {
    const url = new URL(authUrl);
    url.pathname = '/auth/client-portal/signin';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    console.warn('Failed to derive fallback login URL from NEXTAUTH_URL', error);
    return '/auth/client-portal/signin';
  }
}

export default async function ClientPortalHandoffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ottParam = params?.ott;
  const returnParam = params?.return;

  const ott = typeof ottParam === 'string' ? ottParam : null;
  const returnPath = typeof returnParam === 'string' ? returnParam : undefined;

  return (
    <PortalSessionHandoff
      ott={ott}
      returnPath={returnPath}
      fallbackLoginUrl={buildFallbackLoginUrl()}
    />
  );
}
