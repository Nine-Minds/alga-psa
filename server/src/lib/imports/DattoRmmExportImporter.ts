import { CsvImporter } from './CsvImporter';
import { normalizeRmmAssetType } from './assetTypeNormalizer';
import type { FieldMapping, ParsedRecord, ValidationResult } from '../../types/imports.types';
import { ImportValidationError } from '@/lib/imports/errors';
import type { Buffer } from 'node:buffer';

const REQUIRED_COLUMNS = ['Device Hostname', 'Device Type'];
const DEFAULT_DUPLICATE_STRATEGY = {
  exactFields: ['serial_number', 'asset_tag', 'mac_address', 'hostname'],
  fuzzyFields: ['name'],
  fuzzyThreshold: 0.82,
  allowMultipleMatches: true
} as const;

const METADATA_COLUMNS: Record<string, string> = {
  'Site Name': 'site',
  'Customer Name': 'customer',
  'Last Check In': 'last_check_in',
  'Operating System': 'operating_system',
  'OS Version': 'os_version'
};

export class DattoRmmExportImporter extends CsvImporter {
  constructor() {
    super({
      sourceType: 'datto_rmm_export',
      name: 'Datto RMM Export',
      description: 'Importer for Datto RMM device inventory exports.',
      duplicateStrategy: DEFAULT_DUPLICATE_STRATEGY
    });
  }

  getDefaultFieldMapping(): FieldMapping[] {
    return [
      { sourceField: 'Device Hostname', targetField: 'name', required: true },
      { sourceField: 'Device Type', targetField: 'asset_type', required: true },
      { sourceField: 'Device UID', targetField: 'asset_tag' },
      { sourceField: 'Serial Number', targetField: 'serial_number' },
      { sourceField: 'MAC Address', targetField: 'mac_address' },
      { sourceField: 'IP Address', targetField: 'ip_address' }
    ];
  }

  async parse(input: Buffer | string): Promise<ParsedRecord[]> {
    const rows = await super.parse(input);

    return rows.map((record) => {
      const normalized = { ...(record.normalized ?? {}) };

      const deviceType = normalized['Device Type'];
      if (typeof deviceType === 'string') {
        normalized['Device Type'] = normalizeRmmAssetType(deviceType);
      }

      if (typeof normalized['Device Hostname'] === 'string') {
        normalized.hostname = normalized.hostname ?? normalized['Device Hostname'];
        normalized.name = normalized.name ?? normalized['Device Hostname'];
      }

      const metadata = this.extractMetadata(record.raw ?? {});

      return {
        ...record,
        normalized,
        metadata,
        externalId: this.resolveExternalId(record.raw ?? {}, record.rowNumber)
      };
    });
  }

  async validate(records: ParsedRecord[]): Promise<ValidationResult> {
    const base = await super.validate(records);
    const errors = [...base.errors];

    const availableColumns = new Set<string>();
    for (const record of records.slice(0, Math.min(records.length, 10))) {
      Object.keys(record.raw ?? {}).forEach((column) => availableColumns.add(column));
    }

    for (const column of REQUIRED_COLUMNS) {
      if (!availableColumns.has(column)) {
        errors.push(
          new ImportValidationError(
            0,
            column,
            undefined,
            `Column "${column}" is required for the Datto RMM importer.`
          )
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private resolveExternalId(row: Record<string, unknown>, rowNumber: number): string {
    const candidates = [row['Device UID'], row['Datto UID'], row['Device ID'], row['UID']];
    for (const candidate of candidates) {
      const asString = this.toCleanString(candidate);
      if (asString) {
        return asString;
      }
    }
    return `row_${rowNumber}`;
  }

  private extractMetadata(row: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      vendor: 'datto_rmm'
    };

    Object.entries(METADATA_COLUMNS).forEach(([column, key]) => {
      const value = row[column];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          metadata[key] = trimmed;
        }
      } else if (value !== undefined && value !== null) {
        metadata[key] = value;
      }
    });

    return metadata;
  }

  private toCleanString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }

    return null;
  }
}
