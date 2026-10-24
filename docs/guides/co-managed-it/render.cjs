#!/usr/bin/env node
// Render source-grounded review guides and blocked recording scaffolds.
// Usage: node render.cjs /absolute/output/directory --revision <sha> --coverage /absolute/coverage.json
const fs = require('node:fs');
const path = require('node:path');
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
const coverageFile = option('--coverage');
if (args.length) throw new Error(`Unknown argument: ${args[0]}`);
if (!/^[0-9a-f]{7,40}$/i.test(revision)) throw new Error('Candidate revision must be a 7–40 character hexadecimal git SHA.');
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
  return value;
};
const coverageByGuide = new Map();
for (const row of coverage.guides) {
  if (!row || typeof row.guide !== 'string' || coverageByGuide.has(row.guide)) {
    throw new Error('Coverage metadata contains a missing or duplicate guide name.');
  }
  if (row.candidateRevision !== revision || row.status !== 'blocked') {
    throw new Error(`Only blocked coverage rows for ${revision} can be scaffold-rendered (${row.guide}).`);
  }
  if (row.recordedAt !== undefined) {
    throw new Error(`Blocked coverage row ${row.guide} must not claim a recording timestamp.`);
  }
  const paths = row.recordingPaths;
  if (!paths) throw new Error(`Missing recordingPaths for ${row.guide}.`);
  for (const kind of ['webm', 'chapterVtt', 'recordingJson']) safeRelativePath(paths[kind], kind, row.guide);
  if (!Array.isArray(row.missing) || !row.blocker) throw new Error(`Coverage row ${row.guide} must state missing artifacts and a blocker.`);
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
      token.href = `https://github.com/Nine-Minds/alga-psa/blob/${revision}/${sourcePath}${suffix}`;
    }
  }
}});

function recordingScaffold(row, pageName) {
  const paths = row.recordingPaths;
  const webm = path.basename(paths.webm);
  const vtt = path.basename(paths.chapterVtt);
  const json = path.basename(paths.recordingJson);
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

fs.mkdirSync(outputRoot, {recursive:true});
for (const file of files) {
  const source = fs.readFileSync(path.join(sourceRoot,file),'utf8');
  const title = source.match(/^# (.+)$/m)?.[1];
  if (!title) throw new Error(`Missing title in ${file}`);
  const isParent = file === 'README.md';
  const pageName = isParent ? 'guides/index.html' : `guides/${file.replace(/\.md$/, '.html')}`;
  const row = coverageByGuide.get(pageName);
  const scaffold = recordingScaffold(row, pageName);
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
<main id="content"><aside class="provenance"><strong>Candidate source revision:</strong> <code>${revision}</code>. This is a regenerated source guide, not runtime acceptance evidence. Recording status for this guide: <strong>blocked</strong>.</aside><aside class="runtime-status"><strong>Runtime status:</strong> ${escape(runtimeSummary)}</aside>${body}${scaffold.html}</main>
<footer><nav aria-label="Footer navigation">${isParent?'':'<a href="index.html">Back to all guides</a>'}<a href="/">Ticket-screen walkthrough and recorded evidence</a></nav><p>Record Pass, Fail, Blocked or Not run for each flow. Reading a guide does not record approval.</p></footer></body></html>
`;
  fs.writeFileSync(path.join(outputRoot,isParent?'index.html':file.replace(/\.md$/,'.html')),output);
  fs.writeFileSync(path.join(outputRoot,scaffold.json),scaffold.metadata);
  fs.writeFileSync(path.join(outputRoot,scaffold.vtt),scaffold.chapterFile);
}
fs.copyFileSync(path.join(sourceRoot,'styles.css'),path.join(outputRoot,'styles.css'));
console.log(`Rendered ${files.length} guides and blocked recording scaffolds for ${revision} to ${outputRoot}`);
