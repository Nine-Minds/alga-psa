import { readdirSync } from 'node:fs';
import path from 'node:path';

// upload-artifact preserves the common ancestor of the workspace and runner
// temp paths, so a browser evidence artifact unpacks as
// `<...>/e2e-tests/execution-evidence/<file>` and `<...>/_temp/<file>`. Only
// these producer-owned suffixes identify primary evidence; harness-results
// contains intentional failure/skip reports with the same filenames.
export function browserArtifactSuffix(filename) {
  return ['browser-artifact-manifest.json', 'browser-shard.json'].includes(filename)
    ? ['_temp', filename] : ['e2e-tests', 'execution-evidence', filename];
}

export function findBrowserArtifactFiles(directory, filename) {
  const suffix = browserArtifactSuffix(filename);
  const found = [];
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name === filename
        && path.relative(directory, target).split(path.sep).slice(-suffix.length).join('/') === suffix.join('/')) found.push(target);
    }
  };
  visit(directory);
  return found;
}

export function browserArtifact(directory, filename) {
  const found = findBrowserArtifactFiles(directory, filename);
  if (found.length !== 1) throw new Error(`Expected one ${filename} browser artifact, received ${found.length}`);
  return found[0];
}
