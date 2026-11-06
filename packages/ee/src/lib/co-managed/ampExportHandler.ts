export const ampWorkspaceExportAvailability = Object.freeze({ available: false as boolean });

export async function handleCoManagedAmpExport(): Promise<Response> {
  return Response.json({ error: 'UNAVAILABLE' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
