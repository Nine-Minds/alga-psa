export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

export function eeUnavailable(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Microsoft Teams integration is only available in Enterprise Edition.',
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json' },
    }
  );
}
