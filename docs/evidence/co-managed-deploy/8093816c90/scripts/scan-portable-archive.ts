// Decrypts a customer portable workspace archive with the product's own reader and reports, per marker,
// whether it occurs anywhere in the manifest or blobs. Prints only counts, never content.
import { readFileSync } from 'node:fs';
import { openPortableArchive } from '../../../../../packages/co-managed/src/portableArchive';
const [archive, markersJson] = process.argv.slice(2);
const passphrase = readFileSync(0, 'utf8').trim();
const markers: Record<string, string> = JSON.parse(markersJson);
(async () => {
  const opened = await openPortableArchive(archive, passphrase);
  try {
    const manifestText = JSON.stringify(opened.manifest);
    const blobs = opened.files.map((f) => readFileSync(f.path).toString('utf8'));
    const tables = Object.keys((opened.manifest as any).tables ?? (opened.manifest as any).records ?? {});
    const result: Record<string, unknown> = { sourceTenant: opened.context.sourceTenant, blobCount: opened.files.length, manifestBytes: manifestText.length, tableKeys: tables };
    for (const [k, m] of Object.entries(markers)) result[k] = { manifestHits: manifestText.split(m).length - 1, blobHits: blobs.reduce((n, b) => n + b.split(m).length - 1, 0) };
    result.privateCommentTableKeys = tables.filter((t) => /private_comment|co_management_private/i.test(t));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally { await opened.dispose(); }
})().catch((e) => { console.error('scan failed', e?.message); process.exit(1); });
