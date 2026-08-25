import { AMP_SCHEMA_SQL, type AmpManifest, type AmpRecord } from '@alga-psa/migration-spec';
import { canonicalContentSha256 } from './index.js';
type WritableDb = { exec(sql:string):void; prepare(sql:string):{run(...args:unknown[]):unknown} ; close():void };
const sqlite = () => require('node:sqlite') as { DatabaseSync: new (path:string) => WritableDb };
export class AmpPackageBuilder {
  constructor(private readonly path: string) {}
  write(manifest: Omit<AmpManifest,'content_sha256'>, records: Record<string, AmpRecord[]>): AmpManifest {
    const db = new (sqlite().DatabaseSync)(this.path); try { db.exec(AMP_SCHEMA_SQL); const completed = {...manifest, content_sha256: canonicalContentSha256(records)}; const fields=Object.keys(completed); db.prepare(`INSERT INTO amp_manifest (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...fields.map(f=>(completed as any)[f])); for(const [table, rows] of Object.entries(records)) for(const row of rows) { const keys=Object.keys(row); db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k])); } return completed; } finally { db.close(); }
  }
}
