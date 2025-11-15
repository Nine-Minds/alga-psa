// Community Edition stub for extension bundle upload-proxy API
// This feature is only available in Enterprise Edition

export async function POST(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ error: 'Extension bundle upload-proxy is only available in the Enterprise Edition.' }),
    { status: 501, headers: { 'content-type': 'application/json' } }
  );
}
