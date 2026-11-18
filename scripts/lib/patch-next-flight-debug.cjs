// Next 16.4.2 bundles React Flight's dev async ancestry tracker in several
// runtimes. Destroyed resources must release their ancestry even when a newer
// operation still references the metadata node. See react/react#36836.
const fs = require('node:fs');
const path = require('node:path');

const MINIFIED = 'destroy:function(asyncId){pendingOperations.delete(asyncId)}';
const MINIFIED_FIXED = 'destroy:function(asyncId){var retired=pendingOperations.get(asyncId);if(retired){retired.previous=null;retired.awaited=null}pendingOperations.delete(asyncId)}';
const READABLE = 'destroy: function (asyncId) {\n            pendingOperations.delete(asyncId);\n          }';
const READABLE_FIXED = 'destroy: function (asyncId) {\n            var retired = pendingOperations.get(asyncId);\n            if (retired) {\n              retired.previous = null;\n              retired.awaited = null;\n            }\n            pendingOperations.delete(asyncId);\n          }';

function patchFlightDebugSource(source, filename) {
  const before = filename.includes('/react-server-dom-') ? READABLE : MINIFIED;
  const after = filename.includes('/react-server-dom-') ? READABLE_FIXED : MINIFIED_FIXED;
  if (source.split(after).length === 2 && !source.includes(before)) return source;
  if (source.split(before).length !== 2 || source.includes(after)) {
    throw new Error(`React Flight dev tracker changed in ${filename}; revalidate the ancestry repair.`);
  }
  return source.replace(before, after);
}

function patchNextFlightDebug(nextRoot) {
  const version = JSON.parse(fs.readFileSync(path.join(nextRoot, 'package.json'), 'utf8')).version;
  if (version !== '16.4.2') throw new Error(`React Flight ancestry repair requires Next 16.4.2; found ${version}.`);
  const files = [];
  for (const base of ['app-page', 'use-cache-probe-worker']) {
    for (const variant of ['', '-turbo', '-experimental', '-turbo-experimental']) {
      files.push(`dist/compiled/next-server/${base}${variant}.runtime.dev.js`);
    }
  }
  for (const bundler of ['webpack', 'turbopack']) {
    for (const variant of ['', '-experimental']) {
      files.push(`dist/compiled/react-server-dom-${bundler}${variant}/cjs/react-server-dom-${bundler}-server.node.development.js`);
    }
  }
  // Validate every target before changing any file. Production bundles are
  // deliberately absent; this changes development tracing metadata only.
  const changes = files.map(file => {
    const absolute = path.join(nextRoot, file);
    const before = fs.readFileSync(absolute, 'utf8');
    return { absolute, before, after: patchFlightDebugSource(before, absolute) };
  });
  for (const { absolute, before, after } of changes) {
    if (before !== after) fs.writeFileSync(absolute, after);
  }
  return changes.length;
}

module.exports = { patchFlightDebugSource, patchNextFlightDebug };

if (require.main === module) {
  const nextRoot = path.dirname(require.resolve('next/package.json'));
  console.log(`[postinstall] React Flight dev ancestry repair validated in ${patchNextFlightDebug(nextRoot)} bundles.`);
}
