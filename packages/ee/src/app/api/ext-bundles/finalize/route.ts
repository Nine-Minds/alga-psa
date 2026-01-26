// Community Edition stub for extension bundle finalize API
// This feature is only available in Enterprise Edition

export async function POST(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ error: 'Extension bundle finalize is only available in the Enterprise Edition.' }),
    { status: 501, headers: { 'content-type': 'application/json' } }
  );
}
