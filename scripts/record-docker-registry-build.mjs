import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { candidateBuildIdentity, candidateRecordHeader, candidateIdentityFromEnvironment, plain } from './lib/docker-build-identity.mjs';
import { verifyRegistryManifest, registryReferencePattern, registryTagPattern } from './verify-docker-archive-build.mjs';

// Registry transport: the build job pushes the image to the CI candidate
// registry and the consumer pulls it by manifest digest. The record binds the
// digest the build action reported to the manifest bytes the registry actually
// serves (`docker buildx imagetools inspect --raw`), so a consumer that pulls
// `reference@manifestDigest` gets exactly the config this build produced.
export async function recordDockerRegistryBuild(input, manifestPath, outputPath) {
  if (!plain(outputPath)) throw new Error('Output path is required');
  if (path.resolve(manifestPath || '') === path.resolve(outputPath)) throw new Error('Manifest and output paths must differ');
  // A rejected new build must never leave the previous build's evidence usable.
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  const identity = candidateBuildIdentity(input);
  const { reference, tag } = input.registry ?? {};
  if (!plain(reference) || !registryReferencePattern.test(reference) || !plain(tag) || !registryTagPattern.test(tag)) {
    throw new Error('Invalid candidate registry reference');
  }
  if (!plain(manifestPath)) throw new Error('A registry manifest is required');
  const manifest = verifyRegistryManifest(await readFile(manifestPath),
    { manifestDigest: identity.buildReportedDigest, configImageId: identity.configImageId });
  const record = { ...candidateRecordHeader('docker-registry-build'), ...identity,
    registry: { reference, tag, manifestDigest: identity.buildReportedDigest, mediaType: manifest.mediaType, bytes: manifest.bytes } };
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifest, output] = process.argv.slice(2);
  try {
    if (process.argv.length !== 4) throw new Error('Expected manifest and output paths');
    await recordDockerRegistryBuild({ ...candidateIdentityFromEnvironment(),
      registry: { reference: process.env.BUILD_REGISTRY_REFERENCE, tag: process.env.BUILD_REGISTRY_TAG } }, manifest, output);
  } catch {
    // Do not serialize arbitrary metadata, build args, credentials, or filesystem errors.
    if (output && path.resolve(output) !== path.resolve(manifest || '')) await rm(output, { force: true }).catch(() => {});
    console.error('Docker registry build record failed validation or recording');
    process.exitCode = 1;
  }
}
