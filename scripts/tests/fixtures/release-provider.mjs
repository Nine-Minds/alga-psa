import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { recordDockerArchiveBuild } from '../../record-docker-archive-build.mjs';
import { browserArtifactServices, createBrowserArchiveReceipt, buildBrowserArtifactManifest } from '../../lib/browser-artifact-manifest.mjs';
const revision = 'a'.repeat(40), runId = '123', runAttempt = 2;
const policy = JSON.parse(readFileSync(new URL('../../browser-provider-requirements.json', import.meta.url), 'utf8'));
const manifests = {};
const archiveDir = mkdtempSync(path.join(tmpdir(), 'fresh-install-archives-'));
try {
  for (const edition of ['community', 'enterprise']) {
    const context = { revision, edition, runId, runAttempt }, components = [];
    for (const service of browserArtifactServices(edition)) {
      const archive = path.join(archiveDir, `${service}.tar.gz`);
      writeFileSync(archive, gzipSync(Buffer.alloc(1024)));
      const id = `sha256:${'1'.repeat(64)}`, digest = `sha256:${'2'.repeat(64)}`;
      const record = await recordDockerArchiveBuild({ ...context, attempt: runAttempt, service, image: 'candidate:latest',
        dockerfile: 'Dockerfile.build', platform: 'linux/amd64', configImageId: id, buildReportedDigest: digest,
        metadata: { 'containerimage.config.digest': id, 'containerimage.digest': digest } }, archive, path.join(archiveDir, `${service}.json`));
      const receipt = await createBrowserArchiveReceipt(record, archive, context);
      components.push({ record, receipt, inspection: [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': revision } } }] });
    }
    manifests[edition] = buildBrowserArtifactManifest({ ...context, components });
  }
} finally { rmSync(archiveDir, { recursive: true, force: true }); }

export function providerFixture() {
  const artifactManifest = structuredClone(manifests.enterprise), componentServices = {}, registryManifests = {};
  const components = ['server','email-service','worker','hocuspocus','temporal-worker'].map((name,index) => {
    const service = ({server:'server-ee',worker:'workflow-worker'})[name] ?? name;
    const record = artifactManifest.components.find(c=>c.record.service===service).record;
    name = `isolated/Deployment/${name}/containers/${name}`;
    const bytes = Buffer.from(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{mediaType:'application/vnd.oci.image.config.v1+json',size:123,digest:record.configImageId},layers:[],index}));
    registryManifests[name]=bytes.toString('base64'); componentServices[name]=service;
    return {name,revision,build:record.build,image:`registry.example.test/${service}@sha256:${createHash('sha256').update(bytes).digest('hex')}`};
  });
  const specs = policy.editions.enterprise.requirements.map(({identity,providers}) => {
    const [file,projectId,projectName,titles]=identity;
    const requests=Object.fromEntries(providers.map(({provider})=>[provider,{supported:true,complete:true,generation:1,capacity:100,dropped:0,inFlight:0,requests:[provider==='smtp-sink'?{sequence:1,protocol:'smtp',command:'DATA',status:250,aborted:false}:{sequence:1,method:'GET',path:'/fixture',status:200,aborted:false}]}]));
    return {file,title:titles.at(-1),tests:[{projectId,projectName,expectedStatus:'passed',status:'expected',results:[{retry:0,status:'passed',attachments:[{name:'emulator-evidence',contentType:'application/json',body:Buffer.from(JSON.stringify({providers:providers.map(p=>p.provider),requests})).toString('base64')}]}]}]};
  });
  const report={config:{rootDir:'/repo',metadata:{edition:'enterprise',authentication:'credentials',serverLifecycle:'next-production'}},errors:[],stats:{expected:specs.length,unexpected:0,skipped:0,flaky:0},suites:[{specs}]};
  const source={revision,dirty:false,changes:[]};
  return {components,policy:{checkId:'browser-ee',runId,runAttempt,componentServices},raw:{root:'/repo',collected:report,report:structuredClone(report),artifactManifest,registryManifests,evidence:{revision,status:'passed',workingTreeDirty:false,source:{before:source,after:source}}}};
}
