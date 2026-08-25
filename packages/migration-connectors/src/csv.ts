import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { writeConnectorPackage, csvConnector, type CanonicalRecords, type SourceRow } from './index.js';
import type { AmpEntityType } from '@alga-psa/migration-spec';

export type CsvConversionConfig = { outputPath:string; sourceSystem?:string; entities: Partial<Record<AmpEntityType, { file:string; mapping?:Record<string,string> }>> };

/** Converts CSV files into AMP without executing source-provided expressions. */
export async function convertSpreadsheetsToAmp(configPath:string): Promise<{outputPath:string; counts:Record<string,number>}> {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as CsvConversionConfig;
  const records: CanonicalRecords = {};
  for (const [entity, source] of Object.entries(config.entities) as Array<[AmpEntityType, NonNullable<CsvConversionConfig['entities'][AmpEntityType]>]>) {
    const csv = await readFile(resolve(dirname(configPath), source.file), 'utf8');
    const parsed = Papa.parse<Record<string,string>>(csv, { header:true, skipEmptyLines:true });
    if (parsed.errors.length) throw new Error(`${source.file}: ${parsed.errors[0].message}`);
    const rows: SourceRow[] = parsed.data.map((row, index) => Object.fromEntries(Object.entries(row).map(([key,value]) => [source.mapping?.[key] ?? key, value])) as SourceRow & { __row:number });
    records[entity] = entity === 'organizations' ? csvConnector.convert(rows).organizations : rows.map((row, index) => ({ package_record_id:`${entity}-${index + 1}`, source_record_id:String(row.id ?? index + 1), external_identifier_namespace:'csv', extension_json:JSON.stringify({source_row:index + 2, headers:Object.keys(row)}), ...row }));
  }
  const outputPath=resolve(dirname(configPath), config.outputPath);
  writeConnectorPackage(outputPath, csvConnector.declaration, records, config.sourceSystem ?? 'csv');
  return { outputPath, counts:Object.fromEntries(Object.entries(records).map(([table,rows])=>[table,rows?.length ?? 0])) };
}
