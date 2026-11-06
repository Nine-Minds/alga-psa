// Without weights every shard takes its modulo slice of the sorted inventory.
// With weights (file -> milliseconds, from scripts/server-unit-durations.json)
// the heaviest file goes first and each file lands on the lightest shard so far,
// which evens the shards out to within one file of each other; files the
// weights do not know take the median, so a new test never skews a shard. Both
// forms are pure functions of (files, total, weights): every shard and the
// merge job reproduce the same partition from the same checkout.
export function partitionTestFiles(files, index, total, weights = null) {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error('Shard must be a one-based index within a positive shard count');
  }
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || !file)) {
    throw new Error('Cannot partition an empty or invalid file collection');
  }
  if (new Set(files).size !== files.length) throw new Error('Duplicate files in shard inventory');
  const sorted = [...files].sort();
  const selected = weights === null || weights === undefined
    ? sorted.filter((_, position) => position % total === index - 1)
    : balancedPartition(sorted, total, weights)[index - 1];
  if (!selected.length) throw new Error(`Required shard ${index}/${total} would be empty`);
  return selected;
}

function balancedPartition(sorted, total, weights) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new Error('Shard weights must map files to durations');
  const known = sorted.map(file => weights[file]).filter(value => value !== undefined);
  if (known.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Shard weights must be non-negative numbers');
  const median = known.length ? [...known].sort((a, b) => a - b)[Math.floor(known.length / 2)] : 0;
  const weightOf = file => weights[file] ?? median;
  const loads = Array(total).fill(0);
  const shards = Array.from({ length: total }, () => []);
  // Equal loads fall to the shard holding fewer files, so equal (or all
  // unknown) weights degrade to round-robin rather than piling onto shard 1.
  for (const file of [...sorted].sort((a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : 1))) {
    let lightest = 0;
    for (let shard = 1; shard < total; shard++) {
      if (loads[shard] < loads[lightest] || (loads[shard] === loads[lightest] && shards[shard].length < shards[lightest].length)) lightest = shard;
    }
    loads[lightest] += weightOf(file);
    shards[lightest].push(file);
  }
  return shards.map(shard => shard.sort());
}

export function reconcileTestShards({ shards, suite, revision, mode, total, jobResult = 'success', weights = null }) {
  const failures = [];
  // Uploaded JSON is not guaranteed to have the producer's types. Reject its
  // shape before iterating so callers still receive a serializable verdict.
  const fileList = value => Array.isArray(value)
    && value.every(file => typeof file === 'string' && file.trim().length > 0);
  if (!Array.isArray(shards)) failures.push('Missing or invalid shard evidence list');
  else for (const [position, shard] of shards.entries()) {
    if (!shard || typeof shard !== 'object' || Array.isArray(shard)) {
      failures.push(`Shard entry ${position + 1} is not an evidence object`);
      continue;
    }
    if (!fileList(shard.selection?.allFiles)) failures.push(`Shard entry ${position + 1} has invalid required file inventory`);
    for (const key of ['expectedFiles', 'executedFiles']) {
      if (!fileList(shard[key])) failures.push(`Shard entry ${position + 1} has invalid ${key}`);
    }
  }
  if (failures.length) return { schemaVersion: 1, suite, revision, mode, shardCount: total, jobResult,
    status: 'failed', expectedFiles: [], executedFiles: [], counts: null, failures };
  const seen = new Set();
  const executed = new Set();
  const expectedFiles = shards[0]?.selection?.allFiles || [];
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0 };
  if (jobResult !== 'success') failures.push(`Required shard jobs did not succeed: ${jobResult}`);
  if (!Number.isInteger(total) || total < 1 || shards.length !== total) failures.push('Missing or extra shard evidence');
  for (const shard of shards) {
    const selection = shard.selection || {};
    const index = selection.shard?.index;
    if (seen.has(index)) failures.push(`Duplicate shard ${index}`);
    seen.add(index);
    if (shard.suite !== suite || shard.revision !== revision || selection.mode !== mode || selection.shard?.total !== total) {
      failures.push(`Shard ${index} has a different suite, revision or selection`);
    }
    if (shard.source?.before?.revision !== revision || shard.source?.after?.revision !== revision) {
      failures.push(`Shard ${index} lacks matching before/after source evidence`);
    }
    if (shard.status !== 'passed' || !Array.isArray(shard.failures) || shard.failures.length) failures.push(`Shard ${index} did not pass`);
    if (JSON.stringify(selection.allFiles) !== JSON.stringify(expectedFiles)) failures.push(`Shard ${index} collected a different required set`);
    try {
      const required = partitionTestFiles(expectedFiles, index, total, weights);
      for (const key of ['expectedFiles', 'executedFiles']) {
        if (JSON.stringify([...(shard[key] || [])].sort()) !== JSON.stringify(required)) failures.push(`Shard ${index} ${key} differs from its assigned partition`);
      }
    } catch (error) { failures.push(error.message); }
    for (const file of shard.executedFiles || []) {
      if (executed.has(file)) failures.push(`File executed by multiple shards: ${file}`);
      executed.add(file);
    }
    for (const key of Object.keys(counts)) {
      const count = shard.counts?.[key];
      if (!Number.isInteger(count) || count < 0) failures.push(`Shard ${index} has invalid ${key} count`);
      else counts[key] += count;
    }
    if (!(shard.counts?.passed > 0)) failures.push(`Shard ${index} executed no passing assertions`);
  }
  for (let index = 1; index <= total; index++) if (!seen.has(index)) failures.push(`Missing shard ${index}`);
  if (!expectedFiles.length || expectedFiles.some(file => !executed.has(file))) failures.push('Required file coverage is incomplete');
  if (Object.entries(counts).some(([key, count]) => key !== 'passed' && count !== 0)) failures.push('Required shards contain non-passing assertions');
  return { schemaVersion: 1, suite, revision, mode, shardCount: total, jobResult,
    status: failures.length ? 'failed' : 'passed', expectedFiles, executedFiles: [...executed].sort(), counts, failures };
}
