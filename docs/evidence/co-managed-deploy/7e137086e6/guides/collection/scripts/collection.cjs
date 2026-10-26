// Collection walkthrough: open the published guide collection, follow each of the twelve section links,
// and check that the page names this build, that its recording label matches the coverage ledger, and that
// its player plays and seeks to a chapter. Composition only: it does not promote any section guide.
const rt = require('../../scripts/runtime.cjs'), fs = require('fs'), path = require('path');
const root = path.dirname(__dirname), guidesRoot = path.dirname(root);
const SHA = '54e75edfabfd814edb9ca0685a5e46d0e050a470';
const packet = process.env.CM_PACKET_ORIGIN || 'http://100.82.172.57:8874';
const ledger = JSON.parse(fs.readFileSync(path.join(guidesRoot, 'coverage-ledger.json'), 'utf8'));
(async () => {
  const r = await rt.scenario(root, 'collection-recording', async ({ page, go, mark, check, shot, chapter }) => {
    await chapter('Open the guide collection');
    await page.goto(packet + '/guides/index.html', { waitUntil: 'load' });
    await check('collection-names-recorded-runtime', (await page.locator('aside.provenance').innerText()).includes(SHA), {});
    await shot('00-collection');
    const links = await page.$$eval('main a[href]', (as) => [...new Set(as.map((a) => a.getAttribute('href')).filter((h) => /^\d\d-[a-z-]+\.html$/.test(h)))]);
    await check('collection-links-all-twelve-sections', links.length === 12, { links });
    for (const href of links) {
      const guide = 'guides/' + href;
      const expected = ledger.find((l) => l.guide === guide);
      await chapter(`Section ${href.slice(0, 2)}: ${expected?.coverage}`);
      await page.goto(packet + '/guides/index.html', { waitUntil: 'load' });
      await page.locator(`main a[href="${href}"]`).first().click();
      await page.waitForURL('**/' + href);
      const provenance = await page.locator('aside.provenance').innerText();
      const section = page.locator('section.walkthrough-recording');
      const result = await section.locator('p').nth(1).innerText();
      await page.locator('section.walkthrough-recording').scrollIntoViewIfNeeded();
      const played = await page.evaluate(async () => {
        const v = document.querySelector('section.walkthrough-recording video'); v.muted = true;
        if (v.readyState < 1) await new Promise((res) => v.addEventListener('loadedmetadata', res, { once: true }));
        await v.play(); await new Promise((res) => setTimeout(res, 1200)); v.pause();
        const sel = document.querySelector('section.walkthrough-recording select'); const last = sel.options.length - 1;
        sel.selectedIndex = last; const seeked = new Promise((res) => v.addEventListener('seeked', res, { once: true })); sel.dispatchEvent(new Event('change'));
        await seeked; await new Promise((res) => setTimeout(res, 800)); v.pause();
        return { played: v.currentTime > 0, chapters: sel.options.length, seekTarget: Number(sel.options[last].value), currentTime: v.currentTime, duration: v.duration };
      });
      await shot('section-' + href.replace('.html', ''));
      await check(`section-${href.slice(0, 2)}-names-this-build-and-complete-recording`, provenance.includes(SHA) && /Recording status for this guide: complete/.test(provenance), {});
      await check(`section-${href.slice(0, 2)}-result-label-matches-ledger`, result.includes(`Scenario result: ${expected.coverage}:`), { label: result.slice(0, 160), ledger: expected.coverage });
      await check(`section-${href.slice(0, 2)}-player-plays-and-seeks`, played.played && played.chapters === expected.chapters && Math.abs(played.currentTime - played.seekTarget) < 2, played);
    }
    await chapter('Return to the collection');
    await page.goto(packet + '/guides/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    return { status: 'passed', limitations: ['Composition only: verifies that each of the twelve section pages is linked, names this build, carries the ledger coverage label and plays its recording. It does not promote any section guide.'] };
  });
  if (r.scenarioStatus !== 'passed') process.exitCode = 1;
})();
