const L = require('./lib.cjs'), path = require('path');
const fx = require('../fixtures.json');
(async () => { await L.scenario(path.join(path.dirname(__dirname), 'attempts'), 'probe-' + Date.now(), async ({ page, actor, go, inspect, shot }) => {
  await actor(L.alice()); await go(`/msp/co-management/tasks/${L.ids.customer}/${L.ids.relationship}/${fx.taskIds[0]}`);
  await page.waitForTimeout(3000); await page.locator('#co-shared-log-time').click(); await page.waitForTimeout(3000);
  await inspect('alice-logtime'); await shot('alice-logtime');
  await go(`/msp/projects/${fx.projectId}/tasks/${fx.taskIds[0]}`); await page.waitForTimeout(3000); await inspect('alice-native-task'); await shot('alice-native-task');
  return { status: 'probe' }; }); })();
