#!/usr/bin/env node
// Render source-grounded review guides with validated recordings or blocked scaffolds.
// --revision identifies the recorded runtime; --publication-revision optionally
// identifies a later documentation-only publication without relabelling media.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Marked } = require('marked');

const sourceRoot = __dirname;
const repoRoot = path.resolve(sourceRoot, '../../..');
const args = process.argv.slice(2);
const outputRoot = args.shift();
function option(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`Supply ${name} and its value.`);
  }
  const [value] = args.splice(index, 2).slice(1);
  return value;
}
if (!outputRoot || !path.isAbsolute(outputRoot)) {
  throw new Error('Supply an absolute output directory for the rendered guides.');
}
if (path.resolve(outputRoot) === sourceRoot || path.resolve(outputRoot) === repoRoot) {
  throw new Error('Render to a separate directory; keep guide sources separate.');
}
const revision = option('--revision');
const publicationRevision = args.includes('--publication-revision') ? option('--publication-revision') : revision;
const coverageFile = option('--coverage');
if (args.length) throw new Error(`Unknown argument: ${args[0]}`);
if (!/^[0-9a-f]{7,40}$/i.test(revision)) throw new Error('Candidate revision must be a 7–40 character hexadecimal git SHA.');
if (!/^[0-9a-f]{7,40}$/i.test(publicationRevision)) throw new Error('Publication revision must be a 7–40 character hexadecimal git SHA.');
if (!path.isAbsolute(coverageFile)) throw new Error('--coverage must be an absolute path.');
const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
if (coverage.candidateRevision !== revision) {
  throw new Error(`Coverage revision ${coverage.candidateRevision} does not match candidate ${revision}.`);
}
if (!Array.isArray(coverage.guides) || coverage.guides.length !== 14) {
  throw new Error(`Coverage metadata must inventory 14 guides; found ${coverage.guides?.length ?? 'none'}.`);
}
const runtimeSummary = typeof coverage.runtimeSummary === 'string'
  ? coverage.runtimeSummary
  : 'Runtime readiness has not been established by this coverage file.';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = text => text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
const safeRelativePath = (value, field, guide) => {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe ${field} path for ${guide}.`);
  }
  return value.split(/[\\/]/).join(path.sep);
};
const coverageByGuide = new Map();
const outputArtifacts = new Set();
function validateOutputPaths(row) {
  for (const kind of ['webm', 'chapterVtt', 'recordingJson']) {
    const value = safeRelativePath(row.recordingPaths?.[kind], kind, row.guide);
    const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
    if (outputArtifacts.has(normalized)) throw new Error(`Duplicate recording output path ${normalized}.`);
    outputArtifacts.add(normalized);
  }
}
function parseTimestamp(value, guide) {
  const long = /^(\d{2,}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (long) return Number(long[1]) * 3600 + Number(long[2]) * 60 + Number(long[3]) + Number(long[4]) / 1000;
  const short = /^(\d{2,}):(\d{2})\.(\d{3})$/.exec(value);
  if (short) return Number(short[1]) * 60 + Number(short[2]) + Number(short[3]) / 1000;
  throw new Error(`Invalid WebVTT timestamp for ${guide}: ${value}`);
}
function parseChapterVtt(text, guide, durationSeconds) {
  if (!/^WEBVTT(?:\r?\n|$)/.test(text)) throw new Error(`Chapter file for ${guide} must start with WEBVTT.`);
  const cues = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/).slice(1)) {
    const lines = block.trim().split('\n').filter(Boolean);
    if (!lines.length || lines[0].startsWith('NOTE')) continue;
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = /^(\S+)\s+-->\s+(\S+)/.exec(lines[timingIndex]);
    if (!timing) throw new Error(`Malformed chapter cue for ${guide}.`);
    const start = parseTimestamp(timing[1], guide);
    const end = parseTimestamp(timing[2], guide);
    const title = lines.slice(timingIndex + 1).join(' ').trim();
    if (!title || end <= start || end > durationSeconds) throw new Error(`Invalid chapter range/title for ${guide}.`);
    if (cues.length && start <= cues[cues.length - 1].start) throw new Error(`Chapter starts must increase for ${guide}.`);
    cues.push({ start, end, title });
  }
  if (!cues.length) throw new Error(`Completed recording ${guide} needs at least one timed chapter.`);
  return cues;
}
function validateCompletedRecording(row) {
  if (row.testedRevision !== revision) throw new Error(`Completed recording ${row.guide} must be tested at ${revision}.`);
  if (typeof row.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.recordedAt) || !Number.isFinite(Date.parse(row.recordedAt))) throw new Error(`Completed recording ${row.guide} needs an ISO recording timestamp.`);
  if (row.playbackVerified !== true || row.chapterSeekVerified !== true) throw new Error(`Completed recording ${row.guide} must have verified playback and chapter seeking.`);
  if (row.blocker !== undefined || (row.missing !== undefined && (!Array.isArray(row.missing) || row.missing.length))) throw new Error(`Completed recording ${row.guide} cannot contain blocked-row fields.`);
  if (!Array.isArray(row.actors) || !row.actors.length || !Array.isArray(row.steps) || !row.steps.length || !Array.isArray(row.outcomes) || !row.outcomes.length) {
    throw new Error(`Completed recording ${row.guide} needs actors, steps, and outcomes.`);
  }
  if (!row.runtime || (row.runtime.sourceRevision ?? row.runtime.revision) !== revision) throw new Error(`Completed recording ${row.guide} needs runtime provenance for ${revision}.`);
  if (!row.build || row.build.sourceRevision !== revision) throw new Error(`Completed recording ${row.guide} needs build provenance for ${revision}.`);
  if (!Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0) throw new Error(`Completed recording ${row.guide} needs a positive durationSeconds.`);
  const sources = row.recordingSourcePaths;
  if (!sources) throw new Error(`Completed recording ${row.guide} needs recordingSourcePaths relative to the coverage file.`);
  const sourceFiles = {};
  for (const kind of ['webm', 'chapterVtt']) {
    const relative = safeRelativePath(sources[kind], `recording source ${kind}`, row.guide);
    const file = path.resolve(path.dirname(coverageFile), relative);
    let stat;
    try { stat = fs.statSync(file); } catch { throw new Error(`Missing completed recording ${kind} source for ${row.guide}: ${relative}`); }
    if (!stat.isFile() || !file.startsWith(`${path.dirname(path.resolve(coverageFile))}${path.sep}`)) throw new Error(`Unsafe or non-file completed recording source for ${row.guide}.`);
    sourceFiles[kind] = file;
  }
  const webm = fs.readFileSync(sourceFiles.webm);
  if (webm.length < 4 || webm.subarray(0, 4).toString('hex') !== '1a45dfa3') throw new Error(`Completed recording ${row.guide} is not a WebM/EBML file.`);
  const mediaProbe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name', '-of', 'json', sourceFiles.webm], { encoding: 'utf8' });
  if (mediaProbe.error || mediaProbe.status !== 0) throw new Error(`Could not validate playable WebM media for ${row.guide}; ffprobe is required.`);
  let mediaInfo;
  try { mediaInfo = JSON.parse(mediaProbe.stdout); } catch { throw new Error(`ffprobe returned invalid media metadata for ${row.guide}.`); }
  const actualDuration = Number(mediaInfo.format?.duration);
  if (!String(mediaInfo.format?.format_name ?? '').split(',').some(name => name === 'matroska' || name === 'webm') || !Number.isFinite(actualDuration) || Math.abs(actualDuration - row.durationSeconds) > 1.5) {
    throw new Error(`WebM container or duration does not match recording metadata for ${row.guide}.`);
  }
  const vtt = fs.readFileSync(sourceFiles.chapterVtt, 'utf8');
  const cues = parseChapterVtt(vtt, row.guide, row.durationSeconds);
  if (!Array.isArray(row.chapters) || !row.chapters.length || row.chapters.length !== cues.length) throw new Error(`Completed recording ${row.guide} needs chapter metadata matching its VTT cues.`);
  const declaredTitles = row.chapters.map(chapter => typeof chapter === 'string' ? chapter : chapter?.title);
  if (declaredTitles.some((title, index) => title !== undefined && title !== cues[index].title)) throw new Error(`Chapter titles do not match the VTT cues for ${row.guide}.`);
  return { sourceFiles, cues };
}
for (const row of coverage.guides) {
  if (!row || typeof row.guide !== 'string' || coverageByGuide.has(row.guide)) {
    throw new Error('Coverage metadata contains a missing or duplicate guide name.');
  }
  if (row.candidateRevision !== revision || !['blocked', 'complete'].includes(row.status)) throw new Error(`Coverage row ${row.guide} must be blocked or complete for ${revision}.`);
  validateOutputPaths(row);
  const paths = row.recordingPaths;
  if (row.status === 'blocked') {
    if (row.recordedAt !== undefined || row.playbackVerified === true || row.chapterSeekVerified === true) throw new Error(`Blocked coverage row ${row.guide} must not claim completed recording evidence.`);
    if (!Array.isArray(row.missing) || !row.blocker) throw new Error(`Blocked coverage row ${row.guide} must state missing artifacts and a blocker.`);
  } else {
    row.completedRecording = validateCompletedRecording(row);
  }
  coverageByGuide.set(row.guide, row);
}

const files = fs.readdirSync(sourceRoot).filter(file => file.endsWith('.md')).sort();
if (files.length !== 13) throw new Error(`Expected parent and 12 section guides; found ${files.length}.`);
const pageNames = files.map(file => file === 'README.md' ? 'guides/index.html' : `guides/${file.replace(/\.md$/, '.html')}`);
for (const page of ['index.html', ...pageNames]) {
  if (!coverageByGuide.has(page)) throw new Error(`Coverage metadata is missing ${page}.`);
}

const md = new Marked({async:false, renderer:{html:({text}) => escape(text)}, walkTokens: token => {
  if (token.type !== 'link') return;
  const href = token.href;
  if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
    const [target, fragment] = href.split('#');
    const resolved = path.resolve(sourceRoot, target);
    if (!fs.existsSync(resolved)) throw new Error(`Missing guide source link: ${href}`);
    const relative = path.relative(sourceRoot, resolved);
    const suffix = fragment ? `#${fragment}` : '';
    if (!relative.startsWith('..') && path.extname(target) === '.md') {
      token.href = (path.basename(target) === 'README.md' ? 'index.html' : target.replace(/\.md$/, '.html')) + suffix;
    } else {
      const sourcePath = path.relative(repoRoot, resolved).split(path.sep).join('/');
      if (sourcePath.startsWith('..')) throw new Error(`Link escapes repository: ${href}`);
      token.href = `https://github.com/Nine-Minds/alga-psa/blob/${publicationRevision}/${sourcePath}${suffix}`;
    }
  }
}});

function relativeArtifactHref(pageName, artifact) {
  return path.posix.relative(path.posix.dirname(pageName), artifact.replaceAll('\\', '/')) || path.posix.basename(artifact);
}

function recordingScaffold(row, pageName) {
  const paths = row.recordingPaths;
  const webm = relativeArtifactHref(pageName, paths.webm);
  const vtt = relativeArtifactHref(pageName, paths.chapterVtt);
  const json = relativeArtifactHref(pageName, paths.recordingJson);
  const id = slug(path.basename(pageName, '.html')) || 'guide';
  const payload = {
    schemaVersion: 1,
    status: 'blocked',
    candidateRevision: revision,
    testedRevision: row.testedRevision ?? null,
    guide: row.guide,
    actors: row.actors ?? [],
    steps: row.steps ?? [],
    outcomes: row.outcomes ?? [],
    chapters: row.chapters ?? [],
    recordingPaths: paths,
    playbackVerified: false,
    chapterSeekVerified: false,
    blocker: row.blocker,
    missing: row.missing,
    metadataUpdatedAt: coverage.metadataUpdatedAt ?? coverage.checkedAt ?? null,
    runtime: coverage.runtime ?? null,
    build: coverage.build ?? { sourceRevision: revision },
    scenario: row.scenario ?? { guide: row.guide, status: 'planned; not executed' },
    limitations: row.limitations ?? [
      'This guide was not walked because its review application was unavailable.',
      'No WebM or timed chapter data exists; playback and chapter seeking were not verified.',
    ],
  };
  const blockerText = String(row.blocker).replace(/\s*This scaffold is not a recording\.\s*$/i, '');
  return {
    id,
    json,
    vtt,
    metadata: `${JSON.stringify(payload, null, 2)}\n`,
    chapterFile: 'WEBVTT\n\nNOTE Recording is blocked. No chapter timings are asserted.\n',
    html: `<section class="recording-scaffold" id="${id}-recording" data-recording-status="blocked" aria-labelledby="${id}-recording-title">
<h2 id="${id}-recording-title">Walkthrough recording — blocked</h2>
<p role="status"><strong>Blocked:</strong> ${escape(blockerText)} This scaffold is not a recording.</p>
<video controls preload="none" aria-label="${escape(row.guide)} recording, unavailable" aria-disabled="true" data-recording-status="blocked"></video>
<label for="${id}-chapters">Chapters</label><select id="${id}-chapters" disabled aria-describedby="${id}-chapter-status"><option>No verified chapters</option></select>
<p id="${id}-chapter-status">Chapter seeking is unavailable until a WebM is captured and its chapter timings are verified.</p>
<ul><li>WebM: <code>${escape(webm)}</code> — missing</li><li>Chapter scaffold: <a href="${escape(vtt)}">${escape(vtt)}</a></li><li>Blocked recording metadata: <a href="${escape(json)}">${escape(json)}</a></li></ul>
</section>`,
  };
}

function completedRecording(row, pageName) {
  const paths = row.recordingPaths;
  const webm = relativeArtifactHref(pageName, paths.webm);
  const vtt = relativeArtifactHref(pageName, paths.chapterVtt);
  const json = relativeArtifactHref(pageName, paths.recordingJson);
  const id = slug(path.basename(pageName, '.html')) || 'guide';
  const chapters = row.completedRecording.cues;
  const payload = {
    schemaVersion: 1,
    status: 'complete',
    candidateRevision: revision,
    testedRevision: row.testedRevision,
    recordedAt: row.recordedAt,
    durationSeconds: row.durationSeconds,
    guide: row.guide,
    actors: row.actors,
    steps: row.steps,
    outcomes: row.outcomes,
    chapters,
    recordingPaths: paths,
    playbackVerified: true,
    chapterSeekVerified: true,
    runtime: row.runtime,
    build: row.build,
    scenario: row.scenario ?? { guide: row.guide, status: 'executed' },
    limitations: row.limitations ?? [],
  };
  const options = chapters.map((chapter, index) => `<option value="${chapter.start}">${escape(chapter.title)}</option>`).join('');
  return {
    id,
    json,
    vtt,
    metadata: `${JSON.stringify(payload, null, 2)}\n`,
    chapterFile: fs.readFileSync(row.completedRecording.sourceFiles.chapterVtt, 'utf8'),
    sourceFile: row.completedRecording.sourceFiles.webm,
    html: `<section class="walkthrough-recording" id="${id}-recording" data-recording-status="complete" aria-labelledby="${id}-recording-title">
<h2 id="${id}-recording-title">Walkthrough recording</h2>
<p>Recorded ${escape(row.recordedAt)} at revision <code>${escape(row.testedRevision)}</code>. Playback and chapter seeking were verified.</p>
<p><strong>Scenario result:</strong> ${escape(row.scenario?.status ?? 'executed; consult the recorded outcomes')}. A playable recording does not establish acceptance of unverified steps.</p>
${row.limitations?.length ? `<ul class="recording-limitations">${row.limitations.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}
<video controls preload="metadata" aria-label="${escape(row.guide)} walkthrough recording"><source src="${escape(webm)}" type="video/webm"><track kind="chapters" srclang="en" label="Chapters" src="${escape(vtt)}" default></video>
<label for="${id}-chapters">Chapters</label><select id="${id}-chapters">${options}</select>
<p><a href="${escape(json)}">Recording metadata</a> · <a href="${escape(vtt)}">Chapter file</a></p>
<script>(()=>{const section=document.getElementById(${JSON.stringify(`${id}-recording`)});const video=section.querySelector('video');const select=section.querySelector('select');select.addEventListener('change',()=>{video.currentTime=Number(select.value);video.play();});video.addEventListener('timeupdate',()=>{let active=0;for(let i=0;i<select.options.length;i++){if(Number(select.options[i].value)<=video.currentTime)active=i;}select.selectedIndex=active;});})();</script>
</section>`,
  };
}

// outputRoot is the packet's guides directory; coverage paths are relative to
// the packet root. Keep copied artifacts at the locations the inventory names.
function guideArtifactPath(artifact) {
  const normalized = artifact.replaceAll('\\', '/');
  if (!normalized.startsWith('guides/')) throw new Error(`Section guide artifact must be under guides/: ${artifact}`);
  return path.join(outputRoot, normalized.slice('guides/'.length));
}
for (const pageName of pageNames) {
  for (const artifact of Object.values(coverageByGuide.get(pageName).recordingPaths)) guideArtifactPath(artifact);
}
fs.mkdirSync(outputRoot, {recursive:true});
for (const file of files) {
  const source = fs.readFileSync(path.join(sourceRoot,file),'utf8');
  const title = source.match(/^# (.+)$/m)?.[1];
  if (!title) throw new Error(`Missing title in ${file}`);
  const isParent = file === 'README.md';
  const pageName = isParent ? 'guides/index.html' : `guides/${file.replace(/\.md$/, '.html')}`;
  const row = coverageByGuide.get(pageName);
  const recording = row.status === 'complete' ? completedRecording(row, pageName) : recordingScaffold(row, pageName);
  const ids = new Set();
  const body = md.parse(source).replace(/<h([1-6])>(.*?)<\/h\1>/g, (_,depth,content) => {
    const id = slug(content.replace(/<[^>]*>/g,''));
    if (ids.has(id)) throw new Error(`Duplicate heading: ${id}`);
    ids.add(id);
    return `<h${depth} id="${id}">${content}</h${depth}>`;
  }).replace(/<table>/g,'<div class="table-wrap"><table>').replace(/<\/table>/g,'</table></div>');
  const output = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Co-Managed IT</title><meta name="description" content="${escape(title)}: Co-Managed IT human review steps, prerequisites and expected outcomes."><link rel="stylesheet" href="styles.css"></head>
<body><a class="skip" href="#content">Skip to guide</a><header><p>CO-MANAGED IT · HUMAN REVIEW</p><nav aria-label="Guide navigation">${isParent?'':'<a href="index.html">All section guides</a>'}<a href="/">Ticket-screen walkthrough</a></nav></header>
<main id="content"><aside class="provenance"><strong>Guide publication revision:</strong> <code>${publicationRevision}</code>. <strong>Recorded runtime revision:</strong> <code>${revision}</code>. Recording status for this guide: <strong>${row.status}</strong>. Publication does not change the recorded build or establish full scenario acceptance.</aside><aside class="runtime-status"><strong>Runtime status:</strong> ${escape(runtimeSummary)}</aside>${body}${recording.html}</main>
<footer><nav aria-label="Footer navigation">${isParent?'':'<a href="index.html">Back to all guides</a>'}<a href="/">Ticket-screen walkthrough and recorded evidence</a></nav><p>Record Pass, Fail, Blocked or Not run for each flow. Reading a guide does not record approval.</p></footer></body></html>
`;
  fs.writeFileSync(path.join(outputRoot,isParent?'index.html':file.replace(/\.md$/,'.html')),output);
  for (const artifact of [row.recordingPaths.recordingJson, row.recordingPaths.chapterVtt, row.status === 'complete' ? row.recordingPaths.webm : null].filter(Boolean)) {
    fs.mkdirSync(path.dirname(guideArtifactPath(artifact)), {recursive:true});
  }
  fs.writeFileSync(guideArtifactPath(row.recordingPaths.recordingJson),recording.metadata);
  fs.writeFileSync(guideArtifactPath(row.recordingPaths.chapterVtt),recording.chapterFile);
  if (row.status === 'complete') fs.copyFileSync(recording.sourceFile, guideArtifactPath(row.recordingPaths.webm));
}
fs.copyFileSync(path.join(sourceRoot,'styles.css'),path.join(outputRoot,'styles.css'));
console.log(`Rendered ${files.length} guides with completed recordings or blocked scaffolds for ${revision} to ${outputRoot}`);
