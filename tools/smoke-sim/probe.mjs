import puppeteer from 'puppeteer-core';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:47810', defaultViewport: { width: 1500, height: 950 } });
const page = await b.newPage();
const resp = await page.goto('http://localhost:3657/', { waitUntil: 'networkidle2', timeout: 60000 });
console.log('status', resp.status(), 'url', page.url(), 'title', await page.title());
await page.screenshot({ path: process.argv[2] || '/tmp/probe.png', fullPage: false });
console.log('BODY_SNIPPET:', (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n+/g,' | '));
await page.close();
await b.disconnect();
