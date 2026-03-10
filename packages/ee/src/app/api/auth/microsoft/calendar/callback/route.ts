export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Calendar sync is only available in Enterprise Edition.',
    }),
    {
      status: 501,
      headers: {
        'content-type': 'application/json',
      },
    }
  );
}
