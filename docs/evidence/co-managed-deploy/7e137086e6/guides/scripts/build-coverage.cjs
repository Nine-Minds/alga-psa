// Build the renderer's 14-row coverage file from each guide's guide-result.json and its recorded
// scenario (walkthrough.webm, chapters.vtt, recording.json). Coverage labels come from the guide
// results verbatim; nothing is promoted here.
// Usage: node build-coverage.cjs <playerCheck.json|-> [--collection <dir>]
const fs = require('fs'), path = require('path'), cp = require('child_process');
const guidesRoot = path.dirname(__dirname);
const repo = '/home/robert/alga-copies/feature-co-managed-it';
const SHA = '54e75edfabfd814edb9ca0685a5e46d0e050a470';
const dist = '.next-review-final-54e75edf';
const buildId = fs.readFileSync(`${repo}/server/${dist}/BUILD_ID`, 'utf8').trim();
const stamp = fs.readFileSync(`${repo}/server/${dist}/.alga-review-revision`, 'utf8').trim();
const [checkFile] = process.argv.slice(2);
const checks = checkFile && checkFile !== '-' && fs.existsSync(checkFile) ? JSON.parse(fs.readFileSync(checkFile, 'utf8')) : [];

const slots = [
  { guide: 'index.html', dir: '00-main', media: 'main' },
  { guide: 'guides/index.html', dir: 'collection', media: 'collection' },
  ...fs.readdirSync(`${repo}/docs/guides/co-managed-it`).filter((f) => /^\d\d-.*\.md$/.test(f)).sort()
    .map((f) => ({ guide: `guides/${f.replace(/\.md$/, '.html')}`, dir: f.replace(/\.md$/, ''), media: f.replace(/\.md$/, '') })),
];
if (slots.length !== 14) throw Error('expected 14 slots, found ' + slots.length);

function scenarioDir(slot, result) {
  const base = path.join(guidesRoot, slot.dir);
  const candidates = [result?.recordingDir && path.resolve(base, result.recordingDir), result?.recordingDir && path.resolve(guidesRoot, result.recordingDir),
    result?.recordingDir && path.resolve(repo, result.recordingDir)].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(path.join(c, 'walkthrough.webm'))) return c;
  return null;
}
const duration = (file) => Number(cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim());
const vttTitles = (text) => text.replace(/\r/g, '').split(/\n\s*\n/).slice(1).map((b) => b.trim().split('\n').filter(Boolean)).filter((l) => l.some((x) => x.includes('-->')))
  .map((l) => l.slice(l.findIndex((x) => x.includes('-->')) + 1).join(' ').trim());

const rows = [], ledger = [];
for (const slot of slots) {
  const resultFile = path.join(guidesRoot, slot.dir, 'guide-result.json');
  const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
  const recordingPaths = { webm: `guides/current/${SHA}/${slot.media}.webm`, chapterVtt: `guides/current/${SHA}/${slot.media}.vtt`, recordingJson: `guides/current/${SHA}/${slot.media}.json` };
  const dir = scenarioDir(slot, result);
  const base = { guide: slot.guide, candidateRevision: SHA, recordingPaths };
  if (!result || !dir || !fs.existsSync(path.join(dir, 'chapters.vtt'))) {
    rows.push({ ...base, status: 'blocked', blocker: result ? 'The recording for this guide has no WebM/chapter file at its recorded scenario directory.' : 'No recording was produced for this guide on this build.',
      missing: ['Current-build WebM with timed chapters', 'Browser-verified playback and chapter seeking'], scenario: { guide: slot.guide, status: 'not recorded on this build' } });
    ledger.push({ guide: slot.guide, coverage: 'not-recorded' });
    continue;
  }
  const recording = JSON.parse(fs.readFileSync(path.join(dir, 'recording.json'), 'utf8'));
  if (recording.build?.revision?.split('+')[0] !== SHA || recording.build?.buildId !== buildId) throw Error(`${slot.guide}: recording build ${JSON.stringify(recording.build)} is not ${SHA}/${buildId}`);
  if (recording.scenarioStatus === 'failed') throw Error(`${slot.guide}: final recording run is marked failed (${recording.error})`);
  const webm = path.join(dir, 'walkthrough.webm'), vtt = path.join(dir, 'chapters.vtt');
  const check = checks.flatMap((c) => c.videos.map((v) => ({ ...v, page: c.page }))).find((v) => decodeURIComponent(v.src).endsWith(recordingPaths.webm.replace(/^guides\//, '')));
  const verified = Boolean(check?.ok);
  const sections = result.sections || [];
  rows.push({
    ...base, status: 'complete', testedRevision: SHA, recordedAt: recording.recordedAt, durationSeconds: duration(webm),
    actors: result.actors, steps: result.steps, outcomes: result.outcomes, chapters: vttTitles(fs.readFileSync(vtt, 'utf8')),
    playbackVerified: verified, chapterSeekVerified: verified,
    runtime: { sourceRevision: SHA, mode: 'production', origin: recording.origin, buildId, revisionStamp: stamp, dist },
    build: { sourceRevision: SHA, buildId, dist, revisionStamp: stamp },
    recordingSourcePaths: { webm: path.relative(guidesRoot, webm), chapterVtt: path.relative(guidesRoot, vtt) },
    scenario: { guide: slot.guide, coverage: result.coverage, status: `${result.coverage}: ` + sections.map((s) => `${s.section} — ${s.result}`).join('; '), sections,
      resultFile: path.relative(guidesRoot, resultFile), recordingJson: path.relative(guidesRoot, path.join(dir, 'recording.json')) },
    limitations: [...(result.limitations || []), ...((result.missingResources || []).map((m) => `Missing resource: ${m}`))],
    playerCheck: check ? { page: check.page, rangeStatus: check.rangeStatus, played: check.played, chapters: check.chapters?.length, lateSeek: check.lateSeek?.currentTime } : null,
  });
  ledger.push({ guide: slot.guide, coverage: result.coverage, sections: sections.map((s) => `${s.result}`).join('/'), durationSeconds: duration(webm), chapters: vttTitles(fs.readFileSync(vtt, 'utf8')).length, verified });
}
const coverage = {
  candidateRevision: SHA, metadataUpdatedAt: new Date().toISOString(),
  runtimeSummary: `Production review build ${buildId} (source ${SHA.slice(0, 10)}, the evidence-only commit after fix 7e137086e6) served at http://feature-co-managed-it.localhost:23374. Each guide's coverage label is in its recording metadata: covered only where every section was exercised; otherwise partial or blocked-external.`,
  runtime: { sourceRevision: SHA, mode: 'production', origin: 'http://feature-co-managed-it.localhost:23374', buildId, revisionStamp: stamp, dist },
  build: { sourceRevision: SHA, buildId, dist },
  guides: rows,
};
fs.writeFileSync(path.join(guidesRoot, 'video-coverage.json'), JSON.stringify(coverage, null, 2));
fs.writeFileSync(path.join(guidesRoot, 'coverage-ledger.json'), JSON.stringify(ledger, null, 2));
console.table(ledger);
