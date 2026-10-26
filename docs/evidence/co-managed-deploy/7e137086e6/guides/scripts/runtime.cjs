// Guide-recording harness for the co-managed review environment rebuilt on 2026-10-25
// (adapted from reprovision-20261025/scripts/runtime.cjs): adds chapter() markers that
// become a WebVTT chapter file timed against the recorded WebM.
// Credentials are read from the private card directory; nothing secret is written here.
const fs = require('fs'), path = require('path'), cp = require('child_process'), assert = require('node:assert/strict');
const { chromium } = require('/home/robert/alga-copies/feature-co-managed-it/node_modules/playwright');

const worktree = '/home/robert/alga-copies/feature-co-managed-it';
const privateRoot = '/home/robert/card-review-private/co-managed-it-3363';
const origin = process.env.CM_ORIGIN || 'http://feature-co-managed-it.localhost:23374';
// When CM_REVIEW_DIST names a production build, every scenario first proves the origin serves it.
const reviewDist = process.env.CM_REVIEW_DIST || null;
const read = (file) => fs.readFileSync(file, 'utf8').trim();
const build = reviewDist ? {
  dist: reviewDist,
  revision: read(`${worktree}/server/${reviewDist}/.alga-review-revision`),
  buildId: read(`${worktree}/server/${reviewDist}/BUILD_ID`),
} : null;
const fixturesFile = `${privateRoot}/reprovision-20261025-fixtures.json`;
const fixtures = () => (fs.existsSync(fixturesFile) ? JSON.parse(fs.readFileSync(fixturesFile, 'utf8')) : {});
const saveFixtures = (update) => {
  const next = { ...fixtures(), ...update };
  fs.writeFileSync(fixturesFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
};
const credential = (name) => JSON.parse(fs.readFileSync(`${privateRoot}/${name}`, 'utf8'));

function sql(query) {
  return cp.execFileSync('docker', ['exec', 'co-managed-it-postgres', 'psql', '-X', '-t', '-A', '-U', 'postgres', '-d', 'server_co_managed',
    '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim();
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, desc, timeout = 45000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e.message; }
    await delay(500);
  }
  throw Error('Timed out ' + desc + ' ' + JSON.stringify(last));
}

/** Runs one recorded scenario: video, recording.json, screenshots and DOM captures in <root>/<name>. */
async function scenario(root, name, fn) {
  const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: process.env.CM_BROWSER_HEADED !== '1', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir, size: { width: 1440, height: 1000 } } });
  const page = await ctx.newPage(); page.setDefaultTimeout(25000);
  const start = Date.now(); const states = {}; let actorName;
  const out = { scenario: name, recordedAt: new Date(start).toISOString(), origin, build, assertions: [], steps: [], chapters: [], scenarioStatus: 'partial', limitations: [] };
  async function chapter(title) { out.chapters.push({ start: (Date.now() - start) / 1000, title }); await mark('chapter', title); }
  const save = () => fs.writeFileSync(dir + '/recording.json', JSON.stringify(out, null, 2));
  async function mark(title, data) { out.steps.push({ at: new Date().toISOString(), seconds: (Date.now() - start) / 1000, actor: actorName, title, data }); save(); console.log(name, title, JSON.stringify(data ?? '')); }
  async function check(id, condition, data) { assert.ok(condition, id + ' ' + JSON.stringify(data ?? '')); out.assertions.push({ id, passed: true, at: new Date().toISOString(), data }); await mark(id, data); }
  async function actor(who) {
    await page.goto('about:blank'); await ctx.clearCookies(); actorName = who.name;
    await page.goto(origin + '/auth/msp/signin', { waitUntil: 'domcontentloaded', timeout: 90000 });
    // A first request to a dev server compiles the page; submit only once React has hydrated the form,
    // and resubmit if the first click landed before hydration.
    const signedIn = async () => { const s = await ctx.request.get(origin + '/api/auth/session').then((r) => r.json()); return s.user?.email === who.email ? s : null; };
    let session = null;
    for (let attempt = 0; attempt < 4 && !session; attempt++) {
      if (attempt) await page.goto(origin + '/auth/msp/signin', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForFunction(() => { const b = document.querySelector('#msp-sign-in-button'); return b && Object.keys(b).some((k) => k.startsWith('__react')); }, null, { timeout: 90000 });
      await page.locator('#msp-email-field').fill(who.email); await page.waitForTimeout(800);
      await page.locator('#msp-password-field').fill(who.password); await page.locator('#msp-sign-in-button').click();
      session = await until(signedIn, 'form login ' + who.name, 30000).catch(() => null);
    }
    if (!session) throw Error('form login failed for ' + who.name);
    states[who.name] = { email: who.email, tenant: session.user.tenant }; await mark('Fresh form login', states[who.name]);
  }
  async function go(route) { await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(1800); await mark('navigate', route); }
  async function shot(n) { await page.screenshot({ path: dir + '/' + n + '.png', fullPage: true }); }
  async function inspect(n) {
    const v = await page.evaluate(() => ({ url: location.href, text: document.body.innerText,
      inputs: [...document.querySelectorAll('input,button,[role=combobox],select')].map((e) => ({ tag: e.tagName, id: e.id, text: e.textContent?.slice(0, 100), value: e.type === 'password' ? '[redacted]' : e.value, disabled: e.disabled })) }));
    fs.writeFileSync(dir + '/' + n + '.json', JSON.stringify(v, null, 2)); return v;
  }
  try {
    if (build) {
      const html = await (await fetch(origin + '/auth/msp/signin')).text();
      assert.ok(html.includes(build.buildId), 'origin serves build ' + build.buildId);
      const health = await fetch(origin + '/api/health'); assert.equal(health.status, 200, '/api/health');
      await mark('build-verified', { ...build, health: health.status });
    }
    const r = await fn({ page, ctx, dir, actor, go, mark, check, shot, inspect, states, chapter, out });
    out.scenarioStatus = r?.status || 'passed'; out.limitations = r?.limitations || []; if (r?.remaining) out.remaining = r.remaining; if (r?.missingResources) out.missingResources = r.missingResources;
  } catch (e) {
    out.scenarioStatus = 'failed'; out.error = e.message;
    await inspect('failure-dom').catch(() => {}); await shot('failure').catch(() => {}); console.log(name, 'FAILED', e.message);
  } finally {
    const video = page.video(); await ctx.close(); await video.saveAs(dir + '/walkthrough.webm');
    try { out.durationSeconds = Number(cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', dir + '/walkthrough.webm'], { encoding: 'utf8' }).trim()); } catch {}
    out.actors = Object.entries(states).map(([n, s]) => ({ name: n, email: s.email, tenant: s.tenant }));
    if (out.durationSeconds && out.chapters.length) {
      const ts = (v) => { const ms = Math.round(Math.max(0, v) * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return [h, m, sec].map((x) => String(x).padStart(2, '0')).join(':') + '.' + String(ms % 1000).padStart(3, '0'); };
      const limit = Math.floor(out.durationSeconds * 1000) / 1000 - 0.05;
      const cues = out.chapters.filter((c) => c.start < limit).map((c, i, all) => ({ ...c, end: i + 1 < all.length ? all[i + 1].start : limit }));
      out.chapters = cues;
      fs.writeFileSync(dir + '/chapters.vtt', 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.title}\n`).join('\n'));
    }
    save(); await b.close();
  }
  return out;
}

module.exports = { worktree, privateRoot, origin, build, fixtures, saveFixtures, credential, sql, until, delay, scenario, assert };
