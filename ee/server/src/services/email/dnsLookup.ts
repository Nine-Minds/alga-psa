import { promises as dns } from 'dns';

import logger from '@alga-psa/shared/core/logger';
import type { DnsRecord } from 'server/src/types/email.types';

export interface DnsLookupResult {
  record: DnsRecord;
  values: string[];
  matchedValue?: boolean;
  error?: string;
}

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

  for (const record of records) {
    const values = await lookupDnsRecord(record);
    const matchedValue = record.value ? values.some((value) => value.toLowerCase() === record.value.toLowerCase()) : undefined;

    results.push({
      record,
      values,
      matchedValue,
      error: values.length === 0 ? 'not_found' : undefined,
    });
  }

  return results;
}
