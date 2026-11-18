import path from 'node:path';

// The identity every candidate build record carries, whatever transport hands
// the image from the build job to the consumer (a gzip Docker archive artifact
// or a manifest in the CI candidate registry). Recorders add their transport
// section and `kind`; verifiers accept either kind.
export const digestPattern = /^sha256:[a-f0-9]{64}$/;
export const plain = value => typeof value === 'string' && value.trim() === value && value.length > 0;

export function candidateBuildIdentity(input) {
  if (!/^[a-f0-9]{40}$/.test(input?.revision ?? '') || !/^\d+$/.test(String(input?.runId ?? '')) || BigInt(input.runId) <= 0n
    || !Number.isSafeInteger(input?.attempt) || input.attempt <= 0) throw new Error('Invalid build source or run identity');
  if (!plain(input.service) || !/^[a-z0-9][a-z0-9-]*$/.test(input.service)
    || !plain(input.image) || /\s/.test(input.image)
    || !plain(input.dockerfile) || path.isAbsolute(input.dockerfile) || input.dockerfile.split(/[\\/]/).includes('..')
    || !/^linux\/(amd64|arm64)(\/v[0-9]+)?$/.test(input.platform ?? '')) throw new Error('Invalid component build identity');
  if (!digestPattern.test(input.configImageId ?? '') || !digestPattern.test(input.buildReportedDigest ?? '')) throw new Error('Missing or invalid build action identity');
  let metadata;
  try { metadata = typeof input.metadata === 'string' ? JSON.parse(input.metadata) : input.metadata; }
  catch { throw new Error('Invalid build metadata'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || metadata['containerimage.config.digest'] !== input.configImageId
    || metadata['containerimage.digest'] !== input.buildReportedDigest) throw new Error('Build metadata disagrees with action outputs');
  return { revision: input.revision, build: { provider: 'github-actions', runId: String(input.runId), attempt: input.attempt },
    service: input.service, image: input.image, dockerfile: input.dockerfile, platform: input.platform,
    configImageId: input.configImageId, buildReportedDigest: input.buildReportedDigest,
    // These are build-action outputs, not evidence of a published release manifest.
    metadata: { 'containerimage.config.digest': metadata['containerimage.config.digest'], 'containerimage.digest': metadata['containerimage.digest'] } };
}

// `registryPublication` is whether a record attests a *release* registry
// publication. CI candidates never do, including candidates handed between
// jobs through the scratch registry: that manifest digest is a transport
// identity, recorded under `registry`, and is never a release identity.
export const candidateRecordHeader = kind => ({ schemaVersion: 1, kind, registryPublication: false });

export function candidateIdentityFromEnvironment(env = process.env) {
  return { revision: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT),
    service: env.BUILD_SERVICE, image: env.BUILD_IMAGE, dockerfile: env.BUILD_DOCKERFILE, platform: env.BUILD_PLATFORM,
    configImageId: env.BUILD_CONFIG_IMAGE_ID, buildReportedDigest: env.BUILD_REPORTED_DIGEST, metadata: env.BUILD_METADATA };
}
