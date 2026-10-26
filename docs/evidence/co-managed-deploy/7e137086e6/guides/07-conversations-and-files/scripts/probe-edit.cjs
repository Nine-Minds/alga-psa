const L = require('../../06-projects-and-tasks/scripts/lib.cjs'), path = require('path'), fs = require('fs');
const fx = require('../fixtures.json');
const rootText = process.env.ROOT;
(async () => { await L.scenario(path.join(path.dirname(__dirname), 'attempts'), 'probe-edit-' + Date.now(), async ({ page, actor, go, inspect, shot, mark }) => {
  const manifest = JSON.parse(fs.readFileSync(`${L.worktree}/server/${L.build.dist}/server/server-reference-manifest.json`, 'utf8'));
  const rpc = []; page.on('response', async (r) => { const a = r.request().headers()['next-action']; if (a) { const n = manifest.node[a]?.exportedName; const b = await r.text().catch(() => ''); rpc.push({ n, status: r.status(), body: b.slice(0, 600) }); } });
  const id = L.sql(`select comment_id from comments where note::text like '%${rootText}%'`);
  await actor(L.qa()); await go(`/msp/co-management/tickets/${L.ids.customer}/${L.ids.relationship}/${fx.ticketId}`);
  await page.getByRole('button', { name: 'Entry', exact: true }).click(); await page.waitForTimeout(4000);
  rpc.length = 0;
  await page.locator('#edit-comment-' + id + '-button').click();
  const ed = page.locator('[id="' + id + '-save-btn"]').locator('..').locator('..').locator('[contenteditable=true]');
  await ed.click(); await page.keyboard.press('End'); await page.keyboard.type(' probe-edit', { delay: 5 });
  await page.locator('[id="' + id + '-save-btn"]').click();
  const texts = []; for (let i = 0; i < 8; i++) { await page.waitForTimeout(700); texts.push((await page.locator('[role=status],[role=alert],.toast,[data-sonner-toast]').allInnerTexts()).join(' | ')); }
  await shot('after-save'); fs.writeFileSync(path.join(path.dirname(__dirname), 'attempts', 'probe-edit-rpc.json'), JSON.stringify({ rpc, texts, db: L.sql(`select note::text from comments where comment_id='${id}'`) }, null, 2));
  return { status: 'probe' }; }); })();
