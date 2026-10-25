// Tooling-only tests. The synthetic black test clip is playable, but it is not
// product interaction and must never be copied into review evidence or called acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const sourceRoot = __dirname;
const revision = '0123456789abcdef0123456789abcdef01234567';

function fixture({ completed = false, corrupt = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'co-managed-render-test-'));
  const coveragePath = path.join(root, 'coverage.json');
  const outputPath = path.join(root, 'packet', 'guides');
  const files = fs.readdirSync(sourceRoot).filter(name => name.endsWith('.md')).sort();
  const pages = ['index.html', ...files.map(name => name === 'README.md' ? 'guides/index.html' : `guides/${name.replace(/\.md$/, '.html')}`)];
  const guides = pages.map((guide, index) => {
    const stem = `media/${index}`;
    const row = {
      guide,
      recordingPaths: {
        webm: guide === 'index.html' ? 'index.webm' : `${guide.replace(/\.html$/, '-walkthrough.webm')}`,
        chapterVtt: guide === 'index.html' ? 'index.vtt' : `${guide.replace(/\.html$/, '-walkthrough.vtt')}`,
        recordingJson: guide === 'index.html' ? 'index.json' : `${guide.replace(/\.html$/, '-walkthrough.json')}`,
      },
      candidateRevision: revision,
      status: 'blocked',
      missing: ['real recording'],
      blocker: 'Synthetic renderer test only; no runtime evidence.',
    };
    if (completed && index === 1) {
      row.status = 'complete';
      row.testedRevision = revision;
      row.recordedAt = '2026-10-24T00:00:00Z';
      row.playbackVerified = true;
      row.chapterSeekVerified = true;
      row.actors = ['Synthetic test actor'];
      row.steps = [{ action: 'Synthetic renderer fixture' }];
      row.outcomes = ['Renderer emitted player markup'];
      row.scenario = { status: 'partial; provider acceptance blocked' };
      row.limitations = ['External provider <binding> is unavailable.'];
      row.durationSeconds = 12;
      row.runtime = { sourceRevision: revision, environment: 'isolated synthetic renderer test' };
      row.build = { sourceRevision: revision };
      row.recordingSourcePaths = { webm: `${stem}.webm`, chapterVtt: `${stem}.vtt` };
      row.chapters = [{ title: 'Synthetic chapter' }, { title: 'End' }];
      row.missing = undefined;
      row.blocker = undefined;
      fs.mkdirSync(path.join(root, 'media'), { recursive: true });
      const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=2', '-t', '12', '-an', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-f', 'webm', path.join(root, `${stem}.webm`)], { encoding: 'utf8' });
      if (encoded.error || encoded.status !== 0) throw new Error(`Could not create synthetic WebM test clip: ${encoded.stderr || encoded.error}`);
      fs.writeFileSync(path.join(root, `${stem}.vtt`), 'WEBVTT\n\n00:00:00.000 --> 00:00:06.000\nSynthetic chapter\n\n00:00:06.000 --> 00:00:12.000\nEnd\n');
    }
    return row;
  });
  if (corrupt === 'blocked-claims-recorded') {
    guides[1].recordedAt = '2026-10-24T00:00:00Z';
    guides[1].playbackVerified = true;
  }
  if (corrupt === 'missing-media') guides[1].recordingSourcePaths.webm = 'media/missing.webm';
  if (corrupt === 'stale-runtime') guides[1].runtime.sourceRevision = 'deadbeef';
  const coverage = { candidateRevision: revision, guides, runtimeSummary: 'Synthetic test only.' };
  fs.writeFileSync(coveragePath, JSON.stringify(coverage));
  return { root, coveragePath, outputPath };
}

function render(fixtureData) {
  return spawnSync(process.execPath, [path.join(sourceRoot, 'render.cjs'), fixtureData.outputPath, '--revision', revision, '--coverage', fixtureData.coveragePath], { encoding: 'utf8' });
}

test('blocked rows keep timestamp and playback claims prohibited', t => {
  const f = fixture({ corrupt: 'blocked-claims-recorded' });
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const result = render(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not claim completed recording evidence/);
});

test('completed recording renders an embedded player, copied WebM/VTT, metadata, and seek controls', t => {
  const f = fixture({ completed: true });
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const result = render(f);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(path.join(f.outputPath, 'index.html'), 'utf8');
  const guideHtml = fs.readFileSync(path.join(f.outputPath, '01-onboarding.html'), 'utf8');
  assert.match(guideHtml, /data-recording-status="complete"/);
  assert.match(guideHtml, /<video controls/);
  assert.match(guideHtml, /<track kind="chapters"/);
  assert.match(guideHtml, /video\.currentTime=Number\(select\.value\)/);
  assert.match(guideHtml, /src="01-onboarding-walkthrough\.webm"/);
  assert.match(guideHtml, /Scenario result:<\/strong> partial; provider acceptance blocked/);
  assert.match(guideHtml, /External provider &lt;binding&gt; is unavailable/);
  assert.match(guideHtml, /does not establish acceptance of unverified steps/);
  const artifactPath = name => path.join(path.dirname(f.outputPath), `guides/01-onboarding-walkthrough.${name}`);
  assert.equal(fs.readFileSync(artifactPath('webm')).subarray(0, 4).toString('hex'), '1a45dfa3');
  assert.match(fs.readFileSync(artifactPath('vtt'), 'utf8'), /Synthetic chapter/);
  const metadata = JSON.parse(fs.readFileSync(artifactPath('json'), 'utf8'));
  assert.equal(metadata.status, 'complete');
  assert.equal(metadata.testedRevision, revision);
  assert.equal(metadata.chapters.length, 2);
  for (const artifact of Object.values(metadata.recordingPaths)) {
    assert.ok(fs.existsSync(path.join(path.dirname(f.outputPath), artifact)), artifact);
  }
  assert.equal(fs.existsSync(path.join(f.outputPath, 'guides')), false);
  // README.md generates the collection page at outputRoot/index.html. Its row
  // is blocked in this fixture, so the separate collection output remains a scaffold.
  assert.match(html, /data-recording-status="blocked"/);
});

test('completed rows require existing media and current runtime provenance', t => {
  for (const corrupt of ['missing-media', 'stale-runtime']) {
    const f = fixture({ completed: true, corrupt });
    t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
    const result = render(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, corrupt === 'missing-media' ? /Missing completed recording webm source/ : /runtime provenance/);
  }
});
