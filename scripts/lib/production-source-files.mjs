import { readdirSync } from 'node:fs';
import path from 'node:path';

const NON_SOURCE_DIRECTORY = /^(node_modules|dist|generated|__tests__|test|tests|test-utils)$/;

// Writer-coverage scans inspect source trees, never hidden build workspaces or
// symlink targets. A parallel test can create and remove those at any time.
// Keep missing optional roots distinct from errors traversing a source tree:
// swallowing the latter would silently truncate the coverage inventory.
/**
 * @param {string} root
 * @param {string[]} bases
 * @returns {string[]} Repository-relative paths.
 */
export function productionSourceFiles(root, bases) {
  const files = new Set();
  function walk(directory, optional = false) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (optional && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || NON_SOURCE_DIRECTORY.test(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) {
        files.add(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  for (const base of bases) walk(path.join(root, base), true);
  return [...files].sort();
}
