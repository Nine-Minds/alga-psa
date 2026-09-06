export function partitionTestFiles(files, index, total) {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error('Shard must be a one-based index within a positive shard count');
  }
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || !file)) {
    throw new Error('Cannot partition an empty or invalid file collection');
  }
  if (new Set(files).size !== files.length) throw new Error('Duplicate files in shard inventory');
  const selected = [...files].sort().filter((_, position) => position % total === index - 1);
  if (!selected.length) throw new Error(`Required shard ${index}/${total} would be empty`);
  return selected;
}

export function reconcileTestShards({ shards, suite, revision, mode, total, jobResult = 'success' }) {
  const failures = [];
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
      const required = partitionTestFiles(expectedFiles, index, total);
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
