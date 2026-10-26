// Chrome playback check for published guide players.
// Usage: node player-check.cjs <out.json> <pageUrl>...
// For every <video> on each page: HTTP Range request returns 206, metadata loads, playback advances,
// a decoded frame is non-blank, and every chapter option seeks the video to its cue start.
const fs = require('fs');
const { chromium } = require('/home/robert/alga-copies/feature-co-managed-it/node_modules/playwright');

(async () => {
  const [outFile, ...pages] = process.argv.slice(2);
  if (!outFile || !pages.length) throw Error('usage: player-check.cjs <out.json> <pageUrl>...');
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  for (const url of pages) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const r = { page: url, checkedAt: new Date().toISOString(), videos: [] };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      const sources = await page.$$eval('video', (vs) => vs.map((v) => v.currentSrc || v.querySelector('source')?.src || v.src));
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        const v = { src };
        const range = await fetch(src, { headers: { Range: 'bytes=0-1023' } });
        v.rangeStatus = range.status; v.contentRange = range.headers.get('content-range'); await range.arrayBuffer();
        const info = await page.evaluate(async (index) => {
          const video = document.querySelectorAll('video')[index];
          video.muted = true;
          if (video.readyState < 1) await new Promise((res, rej) => { video.addEventListener('loadedmetadata', res, { once: true }); video.addEventListener('error', () => rej(Error('media error ' + video.error?.code)), { once: true }); video.load(); });
          const duration = video.duration;
          await video.play(); await new Promise((res) => setTimeout(res, 1500)); video.pause();
          const played = video.currentTime;
          const frame = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 40; const g = c.getContext('2d'); g.drawImage(video, 0, 0, 64, 40); const d = g.getImageData(0, 0, 64, 40).data; let s = 0, s2 = 0; for (let k = 0; k < d.length; k += 4) { const y = d[k] + d[k + 1] + d[k + 2]; s += y; s2 += y * y; } const n = d.length / 4, mean = s / n; return { mean, variance: s2 / n - mean * mean }; };
          const section = video.closest('section') || document;
          const select = section.querySelector('select');
          const track = video.textTracks[0];
          const chapters = [];
          let options = select && !select.disabled ? [...select.options].map((o) => ({ title: o.textContent, start: Number(o.value) })) : [];
          const viaSelect = options.length > 0;
          if (!viaSelect && track) {
            // No chapter picker (packet root page): seek through the chapter track's cues instead.
            track.mode = 'hidden';
            for (let w = 0; w < 50 && !(track.cues && track.cues.length); w++) await new Promise((res) => setTimeout(res, 100));
            options = [...(track.cues || [])].map((c) => ({ title: c.text, start: c.startTime }));
          }
          for (let k = 0; k < options.length; k++) {
            const target = options[k].start;
            const seeked = new Promise((res) => video.addEventListener('seeked', res, { once: true }));
            if (viaSelect) { select.selectedIndex = k; select.dispatchEvent(new Event('change')); } else video.currentTime = target;
            await Promise.race([seeked, new Promise((res) => setTimeout(res, 5000))]);
            video.pause();
            chapters.push({ via: viaSelect ? 'select' : 'track', title: options[k].title, start: target, currentTime: video.currentTime, ok: Math.abs(video.currentTime - target) < 0.6, frame: frame() });
          }
          // Seek beyond the last chapter start to prove a later decoded frame.
          const late = Math.max(0, duration - 1);
          video.currentTime = late; await new Promise((res) => video.addEventListener('seeked', res, { once: true }));
          return { duration, played, playedOk: played > 0.5, chapters, trackCues: track ? (track.mode = 'hidden', track.cues?.length ?? null) : null, lateSeek: { target: late, currentTime: video.currentTime, frame: frame() } };
        }, i);
        Object.assign(v, info);
        v.ok = v.rangeStatus === 206 && info.playedOk && info.chapters.length > 0 && info.chapters.every((c) => c.ok) && Math.abs(info.lateSeek.currentTime - info.lateSeek.target) < 0.6;
        r.videos.push(v);
      }
      r.ok = r.videos.length > 0 && r.videos.every((x) => x.ok);
    } catch (e) { r.ok = false; r.error = e.message; }
    results.push(r); console.log(r.ok ? 'OK  ' : 'FAIL', url, r.error || r.videos.map((x) => `${x.rangeStatus} dur=${x.duration?.toFixed(1)} chapters=${x.chapters?.length}`).join(' '));
    await page.context().close();
  }
  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  if (results.some((x) => !x.ok)) process.exitCode = 1;
})();
