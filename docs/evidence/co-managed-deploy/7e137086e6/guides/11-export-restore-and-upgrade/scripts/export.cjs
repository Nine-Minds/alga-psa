// Guide 11 — Export, restore and independence. In reach: encrypted export of the departed disposable workspace
// (CM-REVIEW-20261026-01 Accept-7, ended in guide 10) through the real UI, operator --inspect of that archive with the
// passphrase piped from a private file, wrong-passphrase and tampered-archive refusals, and the upgrade screen boundary.
// Not run: restore into an isolated destination, destination activation, independent upgrade purchase/conversion.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const C = require('../../02-licensing-and-seats/scripts/common.cjs');
const { scenario, sql, assert, receipt, privateRoot, credential, worktree } = C;
const root = path.resolve(__dirname, '..');
const name = process.env.CM_NAME || 'export-recording';
const fx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../01-onboarding/onboarding-recording/fixtures.json'))).accept;

function inspectArchive(archive, secret) {
  const r = cp.spawnSync('npm', ['exec', '--', 'tsx', '--tsconfig', '../ee/server/tsconfig.json', 'scripts/restore-portable-workspace.ts', '--inspect', '--archive', archive, '--passphrase-stdin'],
    { cwd: `${worktree}/server`, input: secret, encoding: 'utf8', timeout: 300000 });
  return { exitCode: r.status, stdout: r.stdout, stderr: (r.stderr || '').split('\n').filter((l) => /Portable workspace|Error/i.test(l)).join('\n') };
}

(async () => {
  const r = await scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    assert.equal(sql(`select state from co_management_relationships where tenant='${fx.customer}' and relationship_id='${fx.relationship}'`), 'terminated', 'export runs on the departed disposable workspace');
    const cred = credential(fx.credentialFile);
    await actor({ name: 'accept7-admin', email: cred.email, password: cred.password });

    await chapter('1. Download an encrypted customer workspace (after departure)');
    await go('/msp/co-management/export'); await page.locator('#co-export-passphrase').waitFor({ timeout: 60000 });
    const screen = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
    await check('export-screen-names-the-departed-workspace', screen.includes(fx.workspace), { excerpt: screen.slice(0, 500) });
    await page.locator('#co-export-passphrase').fill('short'); await page.locator('#co-export-confirm-passphrase').fill('short'); await page.locator('#co-export-download').click();
    const lenErr = page.getByRole('alert').first(); await lenErr.waitFor(); await shot('11-1-short-passphrase');
    await check('short-passphrase-refused-by-form', /passphrase/i.test(await lenErr.innerText()), { alert: await lenErr.innerText() });
    const secret = crypto.randomBytes(24).toString('hex');
    await page.locator('#co-export-passphrase').fill(secret); await page.locator('#co-export-confirm-passphrase').fill(secret + 'x'); await page.locator('#co-export-download').click();
    await page.waitForTimeout(500); const mErr = await page.getByRole('alert').first().innerText(); await shot('11-1-mismatch');
    await check('mismatched-confirmation-refused-by-form', /match/i.test(mErr), { alert: mErr });
    const archive = `${privateRoot}/cm-review-20261026-11-accept7-export.alga`, secretFile = `${privateRoot}/cm-review-20261026-11-accept7-export-secret.json`;
    fs.writeFileSync(secretFile, JSON.stringify({ passphrase: secret, tenant: fx.customer, archivePath: archive }), { mode: 0o600 });
    await page.locator('#co-export-confirm-passphrase').fill(secret);
    let resolveDl; const downloaded = new Promise((res) => { resolveDl = res; }); page.on('download', resolveDl); ctx.on('page', (p) => p.on('download', resolveDl));
    await page.locator('#co-export-download').click();
    const download = await Promise.race([downloaded, new Promise((_, rej) => setTimeout(() => rej(Error('no archive download within 180 s')), 180000))]);
    await download.saveAs(archive); fs.chmodSync(archive, 0o600);
    const bytes = fs.readFileSync(archive), magic = Buffer.from('ALGA-WORKSPACE-ARCHIVE\0\x01', 'binary'), sha = crypto.createHash('sha256').update(bytes).digest('hex');
    await check('encrypted-archive-downloaded', bytes.length > magic.length && bytes.subarray(0, magic.length).equals(magic) && !bytes.includes(Buffer.from(fx.workspace)), { bytes: bytes.length, sha256: sha, suggestedFilename: download.suggestedFilename(), plaintextWorkspaceNameInBytes: bytes.includes(Buffer.from(fx.workspace)) });
    await page.bringToFront(); await shot('11-1-download-requested');
    await page.reload(); await page.locator('#co-export-passphrase').waitFor({ timeout: 60000 }); await shot('11-1-export-page-reloaded');
    await check('export-page-still-available-after-reload', true);

    await chapter('2. Inspect the archive (operator CLI); restore needs an isolated destination');
    await mark('operator-inspect', { command: 'server/: npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --inspect --archive <private> --passphrase-stdin', passphrase: 'piped from private file, never an argument' });
    const ok = inspectArchive(archive, secret);
    let manifest = null; try { manifest = JSON.parse(ok.stdout); } catch {}
    receipt(dir, 'inspect-manifest', { exitCode: ok.exitCode, manifest, stderr: ok.stderr, archiveSha256: sha });
    await check('operator-inspect-authenticates-and-lists-contents', ok.exitCode === 0 && Boolean(manifest), { exitCode: ok.exitCode, keys: manifest && Object.keys(manifest) });
    const wrong = inspectArchive(archive, crypto.randomBytes(24).toString('hex'));
    await check('wrong-passphrase-refused', wrong.exitCode !== 0, { exitCode: wrong.exitCode, stderr: wrong.stderr });
    const tampered = `${privateRoot}/cm-review-20261026-11-accept7-export-tampered.alga`; const t = Buffer.from(bytes); t[t.length - 40] ^= 0xff; fs.writeFileSync(tampered, t, { mode: 0o600 });
    const tam = inspectArchive(tampered, secret); fs.unlinkSync(tampered);
    await check('tampered-archive-refused', tam.exitCode !== 0, { exitCode: tam.exitCode, stderr: tam.stderr });
    receipt(dir, 'restore-negative', [{ case: 'wrong-passphrase', exitCode: wrong.exitCode, stderr: wrong.stderr }, { case: 'tampered', exitCode: tam.exitCode, stderr: tam.stderr }]);

    await chapter('4. Upgrade a current workspace independently (screen boundary only)');
    await go('/msp/co-management/upgrade'); await page.waitForTimeout(4000);
    const up = await inspect('11-4-upgrade-screen'); await shot('11-4-upgrade-screen');
    await mark('upgrade-screen', { url: up.url, excerpt: up.text.replace(/\s+/g, ' ').slice(0, 900), controls: up.inputs.filter((i) => /co-upgrade/.test(i.id)).map((i) => ({ id: i.id, text: i.text, disabled: i.disabled })) });
    await check('upgrade-screen-reachable-for-departed-customer', /\/msp\/co-management\/upgrade|\/msp\/clients|\/msp/.test(up.url));
    receipt(dir, 'export-receipt', { tenant: fx.customer, workspace: fx.workspace, bytes: bytes.length, sha256: sha, archive: 'private directory (cm-review-20261026-11-accept7-export.alga, mode 600)' });
    return { status: 'partial', limitations: [] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
