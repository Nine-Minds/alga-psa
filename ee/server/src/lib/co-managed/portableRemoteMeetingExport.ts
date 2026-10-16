import { assertPortableTransferActive, awaitPortableTransfer, createPortableWriteStream, portableTransferSignal } from '../../../../../packages/co-managed/src/portableTransfer';
import { createHash } from 'node:crypto';
import { createPortableTemporaryDirectory } from '../../../../../packages/co-managed/src/portableTemporaryDirectory';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveTeamsMeetingGraphConfig, type TeamsMeetingGraphConfig } from '../../../../packages/microsoft-teams/src/lib/meetings/meetingConfig';
import { getMicrosoftGraphBaseUrl, getMicrosoftTokenUrl } from '../../../../packages/microsoft-teams/src/lib/teams/microsoftEndpoints';
import { withCoManagedExportAdmin } from '../../../../../packages/co-managed/src/portableExport';
import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from '../../../../../packages/co-managed/src/portableSnapshot';
import { consumeCoManagedMeetingArtifact, type NativeMeetingArtifactContent } from '../../../../../packages/co-managed/src/nativeMeetingRead';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import type { PortableStagedBlob } from '../../../../../packages/co-managed/src/portableBlobStaging';

const MAX_FILE = 64 * 1024 ** 3, MAX_TOTAL = 1024 ** 4, IDLE_MS = 30_000;
const FAILURE = 'Portable meeting artifact could not be captured';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Locator = NonNullable<NativeMeetingArtifactContent['provider']>;

async function collect(db: Knex, actor: CoManagedSessionActor, databaseSnapshot?: CoManagedPortableSnapshot) {
  const work = async (current: Knex.Transaction, verified: CoManagedSessionActor) => {
    const own = tenantDb(current, verified.tenant);
    const hints = await own.table('online_meeting_artifacts').whereNull('file_id').orderBy('artifact_id').limit(100_001)
      .select('artifact_id', 'meeting_id', 'document_id', 'file_id', 'artifact_type', 'provider_artifact_id', 'created_at', 'updated_at');
    if (hints.length > 100_000) throw new Error(FAILURE);
    const sources: { artifactId: string; type: 'recording' | 'transcript'; provider: Locator }[] = [];
    const localIds: string[] = [];
    for (const hint of hints) {
      const retained = await consumeCoManagedMeetingArtifact(current, verified.tenant, hint.artifact_id, async () => verified, async content => ({ value: {
        type: content.type, local: Boolean(content.fileId || content.type === 'transcript' && content.blocks != null), provider: content.provider,
      } }));
      if (!retained.handled) throw new CoManagedSharedWorkError();
      const row = await own.table('online_meeting_artifacts').where('artifact_id', hint.artifact_id).forShare()
        .first('artifact_id', 'meeting_id', 'document_id', 'file_id', 'artifact_type', 'provider_artifact_id', 'created_at', 'updated_at');
      if (!row || digest(row) !== digest(hint)) throw new CoManagedSharedWorkError();
      if (retained.value.local) { localIds.push(hint.artifact_id); continue; }
      const meeting = await own.table('online_meetings').where('meeting_id', hint.meeting_id).forShare().first('provider');
      if (!retained.value.provider || meeting?.provider !== 'teams') throw new Error(FAILURE);
      sources.push({ artifactId: hint.artifact_id, type: retained.value.type, provider: retained.value.provider });
    }
    let providerConfiguration: { integration: any; profile: any } | null = null;
    if (sources.length) {
      const integration = await own.table('teams_integrations').forShare().first('selected_profile_id', 'install_status', 'updated_at');
      if (!integration || integration.install_status !== 'active' || !isCoManagedUuid(integration.selected_profile_id)) throw new Error(FAILURE);
      const profile = await own.table('microsoft_profiles').where('profile_id', integration.selected_profile_id).forShare()
        .first('profile_id', 'client_id', 'tenant_id', 'client_secret_ref', 'is_archived', 'updated_at');
      if (!profile || profile.is_archived || !profile.client_id || !profile.client_secret_ref ||
          sources.some(source => source.provider.microsoftTenantId.toLowerCase() !== String(profile.tenant_id).trim().toLowerCase())) throw new Error(FAILURE);
      providerConfiguration = { integration, profile };
    }
    return { hints, localIds, sources, providerConfiguration };
  };
  if (db.isTransaction) {
    if (databaseSnapshot) throw new Error(FAILURE);
    return withCoManagedExportAdmin(db, actor, work);
  }
  return portableSnapshotTransaction(db, databaseSnapshot, trx => withCoManagedExportAdmin(trx, actor, work));
}

function segment(input: string) {
  if (typeof input !== 'string' || !input || input.length > 8192 || input === '.' || input === '..' || /[\x00-\x1f\x7f]/.test(input)) throw new Error(FAILURE);
  return encodeURIComponent(input);
}
function endpoint(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(FAILURE);
  return url.toString().replace(/\/$/, '');
}
function identity(config: TeamsMeetingGraphConfig) {
  return digest({ tenant: config.microsoftTenantId.toLowerCase(), clientId: config.clientId, secret: config.clientSecret,
    graph: endpoint(getMicrosoftGraphBaseUrl()), token: endpoint(getMicrosoftTokenUrl(config.microsoftTenantId)) });
}
async function currentConfig(tenant: string, sources: { provider: Locator }[], expected?: string) {
  const config = await awaitPortableTransfer(() => resolveTeamsMeetingGraphConfig(tenant));
  if (!config || !config.clientId || !config.clientSecret || !config.microsoftTenantId ||
      sources.some(source => source.provider.microsoftTenantId.toLowerCase() !== config.microsoftTenantId.toLowerCase()) || expected && identity(config) !== expected) throw new Error(FAILURE);
  segment(config.microsoftTenantId);
  return config;
}

/** Use the same gated Teams endpoint builders, with redirects disabled for
 * both credential-bearing requests. Error bodies never enter logs or errors. */
function combinedSignal(local: AbortSignal) {
  const request = portableTransferSignal(); return request ? AbortSignal.any([local, request]) : local;
}
async function tokenFor(config: TeamsMeetingGraphConfig) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), IDLE_MS);
  try {
    const response = await fetch(endpoint(getMicrosoftTokenUrl(config.microsoftTenantId)), { method: 'POST', redirect: 'error', signal: combinedSignal(abort.signal),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Encoding': 'identity' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) });
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error(FAILURE); }
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of Readable.fromWeb(response.body as any)) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 64 * 1024) throw new Error(FAILURE); chunks.push(bytes); }
      const data = Buffer.concat(chunks);
      try {
        const token = JSON.parse(data.toString('utf8')).access_token;
        if (typeof token !== 'string' || !token || token.length > 16 * 1024 || /[\r\n]/.test(token)) throw new Error(FAILURE);
        return token;
      } finally { data.fill(0); }
    } finally { for (const chunk of chunks) chunk.fill(0); }
  } finally { clearTimeout(timer); abort.abort(); }
}

/** Fetches only the fixed Graph artifact endpoint formed from an authenticated
 * creation receipt. Stored content_url is never read or used. */
async function stageRemote(source: { artifactId: string; type: 'recording' | 'transcript'; provider: Locator }, token: string, directory: string, remaining: number) {
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(), IDLE_MS); };
  touch();
  try {
    const p = source.provider;
    const url = `${endpoint(getMicrosoftGraphBaseUrl())}/users/${segment(p.organizerUserId)}/onlineMeetings/${segment(p.meetingId)}/${source.type === 'transcript' ? 'transcripts' : 'recordings'}/${segment(p.artifactId)}/content`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' }, redirect: 'error', signal: combinedSignal(abort.signal) });
    const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
    const expected = length === null ? null : /^\d+$/.test(length) ? Number(length) : NaN;
    if (response.status !== 200 || !response.body || encoding && encoding.toLowerCase() !== 'identity' ||
        expected !== null && (!Number.isSafeInteger(expected) || expected < 0 || expected > MAX_FILE || expected > remaining)) {
      await response.body?.cancel(); throw new Error(FAILURE);
    }
    const id = `meeting_artifact:${source.artifactId}`, path = join(directory, `meeting-${source.artifactId}`), hash = createHash('sha256'); let size = 0;
    await pipeline(Readable.fromWeb(response.body as any), new Transform({ transform(chunk, _encoding, callback) {
      touch(); size += chunk.length;
      if (size > MAX_FILE || size > remaining || expected !== null && size > expected) return callback(new Error(FAILURE));
      hash.update(chunk); callback(null, chunk);
    } }), createPortableWriteStream(path), { signal: combinedSignal(abort.signal) });
    if (expected !== null && size !== expected) throw new Error(FAILURE);
    return { id, path, size, sha256: hash.digest('hex') };
  } finally { clearTimeout(timer); abort.abort(); }
}

export async function exportCoManagedPortableRemoteMeetingFiles(db: Knex, inputActor: CoManagedSessionActor, packageId: string, databaseSnapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  assertPortableTransferActive();
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  const snapshot = await collect(db, actor, databaseSnapshot), original = digest(snapshot);
  const { directory, dispose } = await createPortableTemporaryDirectory('remote-meetings');
  try {
    const files: PortableStagedBlob[] = [];
    if (snapshot.sources.length) {
      const config = await currentConfig(actor.tenant, snapshot.sources);
      if (config.clientId !== snapshot.providerConfiguration?.profile.client_id) throw new Error(FAILURE);
      const fingerprint = identity(config), token = await tokenFor(config);
      let total = 0;
      for (const source of snapshot.sources) {
        await currentConfig(actor.tenant, [source], fingerprint);
        const file = await stageRemote(source, token, directory, MAX_TOTAL - total); total += file.size; files.push(file);
      }
      await currentConfig(actor.tenant, snapshot.sources, fingerprint);
    }
    if (digest(await collect(db, actor)) !== original) throw new CoManagedSharedWorkError();
    const sourcesById = new Map(snapshot.sources.map(source => [`meeting_artifact:${source.artifactId}`, source]));
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-remote-meeting-files', version: 1, packageId, sourceTenant: actor.tenant,
      fileBindings: snapshot.sources.map(source => ({ table: 'online_meeting_artifacts', recordId: source.artifactId, field: 'content', blobId: `meeting_artifact:${source.artifactId}` })),
      blobs: files.map(({ path: _path, ...file }) => { const source = sourcesById.get(file.id)!;
        return { ...file, name: `meeting-${source.artifactId}.${source.type === 'transcript' ? 'vtt' : 'mp4'}`, mimeType: source.type === 'transcript' ? 'text/vtt' : 'video/mp4' }; }),
      restorePolicy: { sponsorship: 'none', providerConnections: 'none', artifactContent: 'native_file' } }));
    const assertCurrent = async (trx: Knex.Transaction) => {
      if (!trx.isTransaction || digest(await collect(trx, actor)) !== original) throw new CoManagedSharedWorkError();
    };
    return { component: { ...payload, sha256: digest(payload) }, files, dispose, assertCurrent };
  } catch (error) { await dispose(); if (error instanceof CoManagedSharedWorkError) throw error; throw new Error(FAILURE); }
}
