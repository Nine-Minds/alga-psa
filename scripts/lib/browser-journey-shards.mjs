// Splits one edition's browser journeys across parallel runners.
//
// Playwright's own `--shard` balances by test count, and here that is the wrong
// weight: the two slowest journey files hold one test each and together take
// longer than the other eighteen files. The partition is therefore computed by
// the runner from the full collection and a committed duration profile, with
// longest-processing-time greedy assignment. Every shard of a run computes it
// from the same checkout and the same collection, so the shards agree without
// talking to each other; the merge step then proves the shards' executions add
// up to the whole collection, so a stale profile can only cost balance, never
// coverage.

export const DEFAULT_WEIGHT_SECONDS = 30;

// "2/3" -> { index: 2, total: 3 }. Anything else is a configuration error.
export function parseShard(value) {
  if (value === undefined || value === null || value === '') return null;
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(String(value));
  if (!match) throw new Error(`Invalid browser shard "${value}": expected <index>/<total>`);
  const index = Number(match[1]), total = Number(match[2]);
  if (index > total) throw new Error(`Invalid browser shard "${value}": index exceeds total`);
  return { index, total };
}

// Weight for a file: the profile's number, else the median of the profile so a
// journey that has never been measured lands as a typical one, not a free one.
export function journeyWeight(file, weights) {
  const known = Object.values(weights ?? {}).filter(value => Number.isFinite(value) && value >= 0);
  if (Number.isFinite(weights?.[file]) && weights[file] >= 0) return weights[file];
  if (!known.length) return DEFAULT_WEIGHT_SECONDS;
  const sorted = [...known].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Returns `total` arrays of files (sorted within each shard). Deterministic:
// files are placed heaviest first, ties broken by name, each onto the shard
// with the least load so far, ties broken by the lowest shard index.
export function partitionJourneys({ files, weights = {}, total }) {
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('Browser shard total must be a positive integer');
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file)) throw new Error('Browser journey files must be strings');
  if (new Set(files).size !== files.length) throw new Error('Browser journey files must be unique');
  const shards = Array.from({ length: total }, () => ({ load: 0, files: [] }));
  const ordered = [...files].map(file => ({ file, weight: journeyWeight(file, weights) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  for (const { file, weight } of ordered) {
    let target = 0;
    for (let index = 1; index < shards.length; index++) if (shards[index].load < shards[target].load) target = index;
    shards[target].load += weight;
    shards[target].files.push(file);
  }
  return shards.map(shard => shard.files.sort());
}

export function shardFiles({ files, weights, shard }) {
  const { index, total } = shard;
  return partitionJourneys({ files, weights, total })[index - 1];
}

// The committed profile: seconds per journey file, per edition.
export function readJourneyWeights(profile, edition) {
  if (profile?.schemaVersion !== 1 || profile.unit !== 'seconds' || typeof profile.editions !== 'object') {
    throw new Error('Unsupported browser journey weight profile');
  }
  const weights = profile.editions[edition] ?? {};
  for (const [file, value] of Object.entries(weights)) {
    if (typeof file !== 'string' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid journey weight for ${file}`);
  }
  return weights;
}
