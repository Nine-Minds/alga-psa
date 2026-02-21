export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

export function eeUnavailable(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Microsoft Entra integration is only available in Enterprise Edition.',
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json' },
    }
  );
}

export function optionsResponse(allowedMethods: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': allowedMethods,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
