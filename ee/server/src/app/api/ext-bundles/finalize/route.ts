/*
TODO: RBAC - admin-only
TODO: Validate request schema
TODO: Wire to bundle store and verification
*/
export async function POST(req: Request) {
  const body = { error: "Not Implemented", route: "finalize" };
  return new Response(JSON.stringify(body), {
    status: 501,
    headers: { "content-type": "application/json" },
  });
}