const L = require('../../06-projects-and-tasks/scripts/lib.cjs'), path = require('path');
const fx = require('../fixtures.json');
(async () => { await L.scenario(path.join(path.dirname(__dirname), 'attempts'), 'probe-' + Date.now(), async ({ page, actor, go, inspect, shot }) => {
  await actor(L.qa()); await go(`/msp/co-management/tickets/${L.ids.customer}/${L.ids.relationship}/${fx.ticketId}`);
  await page.getByRole('button', { name: 'Entry', exact: true }).click(); await page.waitForTimeout(6000);
  const html = await page.evaluate(() => [...document.querySelectorAll('a')].filter(a => /removable/.test(a.textContent)).map(a => { let p = a; for (let i = 0; i < 4; i++) p = p.parentElement; return p.outerHTML.slice(0, 3000); }));
  require('fs').writeFileSync(path.join(path.dirname(__dirname), 'attempts', 'probe-removable.html'), html.join('\n\n'));
  await inspect('qa-ticket'); return { status: 'probe' }; }); })();
