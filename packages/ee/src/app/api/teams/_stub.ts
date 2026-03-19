export const dynamic = 'force-dynamic';

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
