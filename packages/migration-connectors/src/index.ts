import { createHash, randomUUID } from 'node:crypto';
import { AmpPackageBuilder } from '@alga-psa/migration-sdk';
import type { AmpManifest, AmpRecord, AmpEntityType } from '@alga-psa/migration-spec';

export type ConnectorDeclaration = { name:string; version:string; supportedAmpVersions:readonly string[]; entityCoverage:readonly AmpEntityType[]; knownOmissions:readonly string[]; sourceSystemVersions?:readonly string[]; licensingPrerequisites?:string };
export type SourceRow = Record<string, string | number | undefined>;
export type CanonicalRecords = Partial<Record<AmpEntityType, AmpRecord[]>>;

/** A connector is deliberately pure: it can produce AMP but cannot access tenant data. */
export interface MigrationConnector { declaration: ConnectorDeclaration; convert(rows: SourceRow[]): CanonicalRecords; }
const id = (namespace:string, value:string) => createHash('sha256').update(`${namespace}:${value}`).digest('hex').slice(0, 32);
const sourceValue = (value: string | number | undefined): string | undefined => value === undefined ? undefined : String(value);
const required = (row:SourceRow, field:string, rowNumber:number):string => { const raw=row[field]; const value=typeof raw === 'string' ? raw.trim() : undefined; if (!value) throw new Error(`Row ${rowNumber}: ${field} is required.`); return value; };
const record = (namespace:string, entity:string, source:string, extra:Record<string, unknown>):AmpRecord => ({ package_record_id:id(namespace,`${entity}:${source}`), source_record_id:source, external_identifier_namespace:namespace, extension_json: JSON.stringify({source_row: extra.__row}), ...extra });

export const csvConnector: MigrationConnector = {
  declaration:{name:'alga-csv-adapter',version:'1.0.0',supportedAmpVersions:['1.0.x'],entityCoverage:['organizations','locations','contacts','tickets','ticket_comments','assets'],knownOmissions:['CSV cannot carry binary attachments.']},
  convert(rows) { const namespace='csv'; return { organizations: rows.map((r,index) => { const source=sourceValue(r.id) ?? String(index + 1); return record(namespace,'organization',source,{name:required(r,'name',index+1)}); }) }; },
};
/** ConnectWise Manage CSV exports commonly name accounts "Company"; only portable fields are carried. */
export const connectWisePsaConnector: MigrationConnector = {
  declaration:{name:'connectwise-psa-csv',version:'1.0.0',supportedAmpVersions:['1.0.x'],sourceSystemVersions:['Manage CSV export'],entityCoverage:['organizations','contacts','tickets'],knownOmissions:['Boards, users, contracts, time entries, invoices and attachments require operator mapping or are omitted.'],licensingPrerequisites:'A ConnectWise Manage export with permission to read Companies, Contacts, and Service Tickets.'},
  convert(rows) { const namespace='connectwise-manage'; const organizations:AmpRecord[]=[]; const contacts:AmpRecord[]=[]; const tickets:AmpRecord[]=[]; for (let index=0;index<rows.length;index++) { const row=rows[index]; const kind=String(row.type ?? row.Type ?? 'company').toLowerCase(); const source=sourceValue(row.id) ?? sourceValue(row.ID) ?? String(index+1); if(kind==='contact') contacts.push(record(namespace,'contact',source,{first_name:row.first_name ?? row['First Name'],last_name:row.last_name ?? row['Last Name'],email:row.email ?? row.Email,organization_package_record_id: row.company_id ? id(namespace,`organization:${row.company_id}`) : undefined})); else if(kind==='ticket') tickets.push(record(namespace,'ticket',source,{title:required(row,'summary',index+1),description:row.description ?? row.Description,status_name:row.status ?? row.Status,priority_name:row.priority ?? row.Priority,organization_package_record_id:row.company_id ? id(namespace,`organization:${row.company_id}`) : undefined})); else organizations.push(record(namespace,'organization',source,{name:required({...row,name:row.name ?? row.Company},'name',index+1)})); } return {organizations,contacts,tickets}; },
};

export function writeConnectorPackage(path:string, declaration:ConnectorDeclaration, records:CanonicalRecords, sourceSystem=declaration.name):AmpManifest {
  return new AmpPackageBuilder(path).write({format_version:'1.0.0',package_id:randomUUID(),created_at:new Date().toISOString(),producer_name:declaration.name,producer_version:declaration.version,source_system:sourceSystem}, records as Record<string,AmpRecord[]>);
}

/** Export seam: callers supply tenant-filtered canonical records; this package never queries Alga. */
export function writeAlgaExport(path:string, records:CanonicalRecords, sourceInstanceId:string):AmpManifest {
  return writeConnectorPackage(path,{name:'alga-export',version:'1.0.0',supportedAmpVersions:['1.0.x'],entityCoverage:['organizations','locations','contacts','tickets','ticket_comments','assets'],knownOmissions:['Binary attachments are not included in AMP v1.']},records,`alga:${sourceInstanceId}`);
}
