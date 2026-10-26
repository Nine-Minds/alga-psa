// T09 export: Alice downloads White Rabbit IT's encrypted portable backup from the product; the archive is
// decrypted with the product reader and scanned. MSP-private notes (stored only in the sponsor's private
// store) must be absent; the customer's own Shared IT, private and requester comments must be present.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const { scenario, privateRoot, worktree } = require('./runtime.cjs');
const { actors, json } = require('./common.cjs');
const root = process.env.CM_ROOT;
const markers = JSON.parse(fs.readFileSync(process.env.T09_MARKERS, 'utf8'));
const passphrase = crypto.randomBytes(18).toString('base64url');
(async () => {
  const r = await scenario(root, '05-t09-export', async ({ page, ctx, actor, go, check, shot, chapter, dir }) => {
    await chapter('Alice prepares and downloads the encrypted White Rabbit IT backup');
    await actor(actors.alice()); await go('/msp/co-management/export'); await page.locator('#co-export-passphrase').waitFor({ timeout: 60000 });
    await page.locator('#co-export-passphrase').fill(passphrase); await page.locator('#co-export-confirm-passphrase').fill(passphrase); await shot('01-export-form');
    const download = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('no download in 180s')), 180000);
      const done = (d) => { clearTimeout(t); resolve(d); }; page.on('download', done); ctx.on('page', (p) => p.on('download', done)); page.locator('#co-export-download').click(); });
    const file = path.join(privateRoot, '5a822cb47e-t09-export.alga-backup'); await download.saveAs(file);
    fs.writeFileSync(path.join(privateRoot, '5a822cb47e-t09-export-secret.json'), JSON.stringify({ passphrase }), { mode: 0o600 });
    const bytes = fs.readFileSync(file);
    const receipt = { downloadName: download.suggestedFilename(), sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), retainedPrivately: true };
    fs.writeFileSync(path.join(dir, 'download-receipt.json'), JSON.stringify(receipt, null, 2)); await shot('02-after-download');
    await chapter('Decrypt with the product reader and scan for markers');
    const scanMarkers = { ...markers, legacyQaPrivate: 'DEPLOY-4E5F-QA-MSP-PRIVATE', legacyAliceShared: 'DEPLOY-4E5F-ALICE-SHARED-IT' };
    const out = cp.execFileSync(process.execPath, [worktree + '/node_modules/tsx/dist/cli.mjs', path.join(__dirname, 'scan-portable-archive.ts'), file, JSON.stringify(scanMarkers)],
      { cwd: worktree + '/server', input: passphrase, encoding: 'utf8', maxBuffer: 8e6, timeout: 300000 });
    const scan = JSON.parse(out); fs.writeFileSync(path.join(dir, 'archive-scan.json'), JSON.stringify(scan, null, 2));
    const hits = (k) => scan[k].manifestHits + scan[k].blobHits;
    await check('archive-is-white-rabbit', scan.sourceTenant === 'c64b2666-7dd6-4c61-8ced-4b233f628e61', { sourceTenant: scan.sourceTenant });
    await check('archive-contains-customer-owned-markers', hits('shared') > 0 && hits('orgPrivate') > 0 && hits('requester') > 0 && hits('legacyAliceShared') > 0, scan);
    await check('archive-excludes-msp-private-notes', hits('mspPrivate') === 0 && hits('legacyQaPrivate') === 0 && scan.privateCommentTableKeys.length === 0, scan);
    return { status: 'passed', limitations: ['Archive and passphrase are retained only in the private card directory; evidence keeps the hash and the marker-level scan.'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
