/** Community edition has no sponsored workspace/vault export service. */
export async function handleCoManagedPortableExport(_request: Request): Promise<Response> {
  return Response.json({ error: 'Portable workspace export is unavailable in this edition.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
