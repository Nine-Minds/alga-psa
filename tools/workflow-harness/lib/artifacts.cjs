const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeFileSegment(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function createArtifactWriter({ artifactsDir, testId, runId, now = new Date() }) {
  const root = path.join(
    artifactsDir,
    'workflow-harness',
    safeFileSegment(testId),
    `${now.toISOString().replace(/[:.]/g, '-')}${runId ? `-${safeFileSegment(runId)}` : ''}`
  );
  ensureDir(root);

  function writeJson(filename, data) {
    const full = path.join(root, filename);
    fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return full;
  }

  function writeText(filename, text) {
    const full = path.join(root, filename);
    fs.writeFileSync(full, String(text ?? ''), 'utf8');
    return full;
  }

  return { root, writeJson, writeText };
}

module.exports = {
  createArtifactWriter
};

