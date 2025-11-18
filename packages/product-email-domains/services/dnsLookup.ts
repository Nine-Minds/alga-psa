import { promises as dns } from 'dns';

import logger from '@alga-psa/shared/core/logger';
import type { DnsRecord, DnsLookupResult } from '@shared/types/email';

const normalize = (value?: string | null): string | null =>
  typeof value === 'string' ? value.trim().toLowerCase() : null;

const stripMxPriority = (value: string): string => value.replace(/^\d+\s+/, '').trim();

function flattenTxtRecords(records: string[][]): string[] {
  return records.map((entry) => entry.join(''));
}

async function resolveTxt(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return flattenTxtRecords(records);
  } catch (error: any) {
    logger.debug(`[ManagedDomain] TXT lookup failed`, { name, error: error?.message });
    return [];
  }
}

async function resolveMx(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(name);
    return records.map((record) => `${record.priority} ${record.exchange}`.trim());
  } catch (error: any) {
    logger.debug(`[ManagedDomain] MX lookup failed`, { name, error: error?.message });
    return [];
  }
}

async function resolveCname(name: string): Promise<string[]> {
  try {
    return await dns.resolveCname(name);
  } catch (error: any) {
    logger.debug(`[ManagedDomain] CNAME lookup failed`, { name, error: error?.message });
    return [];
  }
}

async function resolveA(name: string): Promise<string[]> {
  try {
    return await dns.resolve4(name);
  } catch (error: any) {
    logger.debug(`[ManagedDomain] A-record lookup failed`, { name, error: error?.message });
    return [];
  }
}

export async function lookupDnsRecord(record: DnsRecord): Promise<string[]> {
  switch (record.type) {
    case 'TXT':
      return resolveTxt(record.name);
    case 'MX':
      return resolveMx(record.name);
    case 'CNAME':
      return resolveCname(record.name);
    case 'A':
      return resolveA(record.name);
    default:
      logger.warn(`[ManagedDomain] Unsupported DNS record type`, record);
      return [];
  }
}

export async function verifyDnsRecords(records: DnsRecord[]): Promise<DnsLookupResult[]> {
  const results: DnsLookupResult[] = [];
  const checkedAt = new Date().toISOString();

  for (const record of records) {
    const values = await lookupDnsRecord(record);
    let matchedValue: boolean | undefined;

    if (record.value) {
      const expected = normalize(record.value);
      if (expected) {
        matchedValue = values.some((raw) => {
          const normalizedValue = normalize(raw);
          if (!normalizedValue) {
            return false;
          }

          if (record.type === 'MX') {
            const withoutPriority = stripMxPriority(normalizedValue);
            if (withoutPriority === expected) {
              return true;
            }

            if (record.priority != null) {
              const prefixed = `${record.priority}`.trim();
              if (normalizedValue.startsWith(`${prefixed} `) && withoutPriority === expected) {
                return true;
              }
            }

            return normalizedValue === expected;
          }

          return normalizedValue === expected;
        });
      }
    }

    if (typeof matchedValue === 'undefined' && record.value) {
      matchedValue = false;
    }
    const error: DnsLookupResult['error'] =
      values.length === 0
        ? 'not_found'
        : record.value && matchedValue === false
          ? 'mismatch'
          : undefined;

    results.push({
      record,
      values,
      matchedValue,
      error,
      checkedAt,
    });
  }

  return results;
}
