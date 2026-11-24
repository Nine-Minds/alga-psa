/**
 * Fixtures shaped like the PBNJ / Domotz sample (alga-2026-0003139): Microsoft 365
 * stamps a top Authentication-Results block with `dkim=none dmarc=fail` because the
 * Avanan (Check Point Harmony) gateway rewrote the message, while the gateway's own
 * block and its sealed ARC-Authentication-Results carry `spf=pass` / `dkim=pass
 * header.d=domotz.com`. ARC seals are generated for real with mailauth and a throwaway
 * RSA key; DNS is a mocked resolver.
 */
import { generateKeyPairSync } from 'node:crypto';
import { simpleParser } from 'mailparser';

export const FROM_ADDRESS = 'phill@domotz.com';

export const MS_TOP_BLOCK =
  'spf=pass (sender IP is 52.1.2.3) smtp.mailfrom=bounce.avanan.net; dkim=none (message not signed) header.d=none; dmarc=fail action=none header.from=domotz.com';
export const AVANAN_LOWER_BLOCK = 'mx.avanan.net; spf=pass smtp.mailfrom=domotz.com';
export const AVANAN_ARC_RESULTS = 'mx.avanan.net; spf=pass smtp.mailfrom=domotz.com; dkim=pass header.d=domotz.com';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = keys.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const publicKeyB64 = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

/** DNS resolver that only knows the test selector key for the given signing domains. */
export function mockDkimResolver(signingDomains: string[] = ['avanan.net']) {
  const known = new Set(signingDomains.map((d) => `sel._domainkey.${d}`));
  return async (name: string, rrtype: string) => {
    if (rrtype === 'TXT' && known.has(name.toLowerCase())) {
      return [[`v=DKIM1; k=rsa; p=${publicKeyB64}`]];
    }
    const error: NodeJS.ErrnoException = new Error(`queryTxt ENOTFOUND ${name}`);
    error.code = 'ENOTFOUND';
    throw error;
  };
}

const crlf = (value: string) => value.replace(/\r?\n/g, '\r\n');

export interface GatewayMessageOptions {
  /** Seal the message as a gateway would (default true). */
  seal?: boolean;
  signingDomain?: string;
  /** The ARC-Authentication-Results value (authserv-id first). */
  arcAuthResults?: string;
  fromAddress?: string;
  /** Alters the body after sealing so the seal no longer verifies. */
  tamperAfterSeal?: boolean;
  topBlock?: string;
  lowerBlock?: string | null;
}

export async function buildGatewayMessage(options: GatewayMessageOptions = {}) {
  const fromAddress = options.fromAddress ?? FROM_ADDRESS;
  const body = 'Please open a ticket for our monitoring alert.\r\n';
  const base =
    `From: Phill <${fromAddress}>\r\nTo: support@msp.example\r\nSubject: Alert\r\n` +
    `Date: Mon, 23 Nov 2026 10:00:00 +0000\r\nMessage-ID: <gw-1@domotz.com>\r\n\r\n${body}`;

  let sealHeaders = '';
  if (options.seal !== false) {
    const { sealMessage } = await import('mailauth');
    sealHeaders = crlf(String(await sealMessage(Buffer.from(base), {
      signingDomain: options.signingDomain ?? 'avanan.net',
      selector: 'sel',
      privateKey: privateKeyPem,
      authResults: options.arcAuthResults ?? AVANAN_ARC_RESULTS,
      cv: 'none',
    })));
  }

  const lower = options.lowerBlock === undefined ? AVANAN_LOWER_BLOCK : options.lowerBlock;
  const mtaHeaders =
    `Authentication-Results: ${options.topBlock ?? MS_TOP_BLOCK}\r\n` +
    (lower ? `Authentication-Results: ${lower}\r\n` : '');
  let raw = mtaHeaders + sealHeaders + base;
  if (options.tamperAfterSeal) raw = raw.replace('monitoring alert', 'monitoring alerT');

  const rawMime = Buffer.from(raw);
  const parsed = await simpleParser(rawMime);
  // Same shape the ingest path builds: lower-cased names, repeated headers joined in wire order.
  const headers: Record<string, string> = {};
  parsed.headers.forEach((value: unknown, key: string) => {
    if (typeof value === 'string') headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.filter((v): v is string => typeof v === 'string').join('\n');
  });
  return { rawMime, headers };
}
