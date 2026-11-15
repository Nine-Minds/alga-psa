// Classifies a failed release-tree smoke run (upgrade-order gate, CM L0g).
// A missing host executable (pdftotext, ...) is a runner problem, not evidence that the
// released code breaks on the new schema, so it must be reported as "undecided".

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

// Each pattern captures the executable name in group 1.
const MISSING_EXECUTABLE = [
  /\bspawn(?:Sync)?\s+(\S+)\s+ENOENT\b/g, // Node: "spawnSync pdftotext ENOENT", "Error: spawn x ENOENT"
  /(?:^|[\s:])(?:\w*sh|bash|dash): (?:line )?\d+: (\S+): (?:command )?not found/gm, // "sh: 1: x: not found", "bash: line 1: x: command not found"
  /(?:^|[\s:])(?:\w*sh|bash|dash): (\S+): command not found/gm, // "bash: x: command not found"
];

/**
 * @param {string} output combined stdout+stderr of the smoke run
 * @returns {{kind: 'environment', tools: string[]} | {kind: 'incompatible'}}
 */
export function classifySmokeFailure(output) {
  const text = String(output ?? '').replace(ANSI, '');
  const tools = new Set();
  for (const re of MISSING_EXECUTABLE) {
    for (const m of text.matchAll(re)) tools.add(m[1].replace(/^['"`]|['"`,;]+$/g, ''));
  }
  return tools.size ? { kind: 'environment', tools: [...tools].sort() } : { kind: 'incompatible' };
}

/** Lines printed for an environment failure (one per tool). */
export function environmentMessages(tools) {
  return tools.map((t) => `upgrade-order could not run: ${t} missing on the runner`);
}
