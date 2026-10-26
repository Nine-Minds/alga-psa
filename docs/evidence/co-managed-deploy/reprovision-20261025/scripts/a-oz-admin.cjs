// Stage A: the seeded Oz administrator (Glinda) creates the review admin qa@emeraldcity.oz through Settings > Users.
const { scenario, credential, sql, until, saveFixtures } = require('./runtime.cjs');
const root = process.env.CM_ROOT;
(async () => {
  const r = await scenario(root, 'a-oz-admin', async ({ page, actor, go, check, shot, mark }) => {
    const glinda = credential('glinda-dev-login.json'), qa = { name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password };
    const oz = sql(`select tenant from tenants where client_name='Oz'`);
    await actor({ name: 'glinda', email: glinda.email, password: glinda.password });
    if (sql(`select count(*) from users where tenant='${oz}' and email='qa@emeraldcity.oz'`) === '0') {
      await go('/msp/settings/users'); await page.locator('#create-new-msp-user-btn').click();
      await page.locator('#first-name').fill('QA'); await page.locator('#last-name').fill('Tester'); await page.locator('#email').fill(qa.email);
      await page.locator('#password').fill(qa.password);
      const roleBox = page.getByRole('combobox').filter({ hasText: /Admin|Dispatcher|Finance|Manager|Technician|Select/ }).first();
      if (!/^\s*Admin\s*$/.test(await roleBox.innerText())) { await roleBox.click(); await page.getByRole('option', { name: 'Admin', exact: true }).click(); }
      await shot('new-user-form');
      await page.locator('#submit-new-msp-user-btn').click();
      await until(() => sql(`select count(*) from users where tenant='${oz}' and email='qa@emeraldcity.oz'`) === '1', 'qa user created');
    }
    const role = sql(`select string_agg(r.role_name, ',') from users u join user_roles ur on ur.tenant=u.tenant and ur.user_id=u.user_id join roles r on r.tenant=ur.tenant and r.role_id=ur.role_id where u.tenant='${oz}' and u.email='qa@emeraldcity.oz'`);
    await check('qa-admin-exists-in-oz', role.split(',').includes('Admin'), { role });
    await actor(qa); await go('/msp/dashboard'); await shot('qa-signed-in');
    const qaId = sql(`select user_id from users where tenant='${oz}' and email='qa@emeraldcity.oz'`);
    saveFixtures({ oz, qaId, glindaId: sql(`select user_id from users where tenant='${oz}' and email='glinda@emeraldcity.oz'`) });
    await check('qa-signs-in-to-oz', true, { oz, qaId });
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
