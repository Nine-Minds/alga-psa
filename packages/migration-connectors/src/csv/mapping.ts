import { AMP_TABLE_COLUMNS, type AmpEntityType } from '@alga-psa/migration-spec';
import { parseSpreadsheet } from './parse';
const aliases: Record<string, string> = { 'asset type': 'asset_type_name', asset_type: 'asset_type_name', 'asset name': 'name', hostname: 'name', 'serial number': 'serial_number', serial: 'serial_number', 'asset tag': 'asset_tag', mac: 'mac_address', 'mac address': 'mac_address', ip: 'ip_address', 'ip address': 'ip_address' };
/** Maps canonical and legacy asset headers; unmatched source columns are preserved as bounded AMP diagnostics. */
export async function inferSpreadsheetMapping(path: string, entityType: AmpEntityType): Promise<Record<string, string>> {
  const { headers } = await parseSpreadsheet(path); const allowed = new Set(AMP_TABLE_COLUMNS[entityType]);
  return Object.fromEntries(headers.flatMap((header) => { const normalized = header.trim().toLowerCase().replace(/\s+/g, '_'); const target = allowed.has(normalized) ? normalized : aliases[header.trim().toLowerCase()]; return target && allowed.has(target) ? [[header, target]] : []; }));
}
