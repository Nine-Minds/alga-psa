/** Community edition has no sponsored workspace export service. The stub reports an
 * unavailable shape and never throws, so a caller can render "unavailable" instead of failing. */
export const portableWorkspaceExportAvailability = Object.freeze({ available: false as boolean });

export async function handleCoManagedPortableExport(_request: Request): Promise<Response> {
  return Response.json({ available: false, error: 'Portable workspace export is unavailable in this edition.' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
