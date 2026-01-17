'use server';

import * as dns from 'dns/promises';

/**
 * ASM Scanner TypeScript Utilities
 *
 * These utilities provide TypeScript-based scanning capabilities for:
 * - DNS record lookups (A, AAAA, MX, NS, TXT, SOA, CNAME)
 * - Email security checks (SPF, DMARC, DKIM)
 * - HTTP header security checks
 *
 * Note: More intensive scanning (port scanning, certificate transparency,
 * vulnerability correlation) is handled by external scanner pods.
 */

// DNS Record Types
export interface IDnsARecord {
  address: string;
  ttl?: number;
}

export interface IDnsAAAARecord {
  address: string;
  ttl?: number;
}

export interface IDnsMxRecord {
  exchange: string;
  priority: number;
}

export interface IDnsNsRecord {
  value: string;
}

export interface IDnsTxtRecord {
  value: string[];
}

export interface IDnsSoaRecord {
  nsname: string;
  hostmaster: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minttl: number;
}

export interface IDnsCnameRecord {
  value: string;
}

export interface IDnsRecords {
  a: IDnsARecord[];
  aaaa: IDnsAAAARecord[];
  mx: IDnsMxRecord[];
  ns: IDnsNsRecord[];
  txt: IDnsTxtRecord[];
  soa: IDnsSoaRecord | null;
  cname: IDnsCnameRecord[];
}

// Email Security Types
export interface ISpfRecord {
  present: boolean;
  record?: string;
  policy?: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none';
  includes?: string[];
  ip4?: string[];
  ip6?: string[];
  all?: string;
}

export interface IDmarcRecord {
  present: boolean;
  record?: string;
  policy?: 'none' | 'quarantine' | 'reject';
  subdomain_policy?: 'none' | 'quarantine' | 'reject';
  pct?: number;
  rua?: string[];
  ruf?: string[];
}

export interface IDkimRecord {
  present: boolean;
  selector?: string;
  record?: string;
  key_type?: string;
}

export interface IEmailSecurityReport {
  spf: ISpfRecord;
  dmarc: IDmarcRecord;
  dkim: IDkimRecord[];
}

// HTTP Security Headers Types
export interface ISecurityHeaders {
  'strict-transport-security'?: string;
  'content-security-policy'?: string;
  'x-frame-options'?: string;
  'x-content-type-options'?: string;
  'x-xss-protection'?: string;
  'referrer-policy'?: string;
  'permissions-policy'?: string;
  server?: string;
  'x-powered-by'?: string;
}

export interface IHttpHeadersReport {
  status_code: number;
  headers: Record<string, string>;
  security_headers: ISecurityHeaders;
  missing_security_headers: string[];
  server_info?: string;
  technology_hints?: string[];
}

// Common DKIM selectors to check
const COMMON_DKIM_SELECTORS = [
  'default',
  'google',
  'selector1', // Microsoft 365
  'selector2', // Microsoft 365
  'k1',
  'k2',
  'dkim',
  's1',
  's2',
  'mail',
  'email',
  'mandrill',
  'smtp',
  'mta',
  'amazonses',
  'postfix',
];

// Required security headers
const REQUIRED_SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
];

/**
 * Resolve A records for a domain
 */
export async function resolveARecords(domain: string): Promise<IDnsARecord[]> {
  try {
    const addresses = await dns.resolve4(domain);
    return addresses.map(address => ({ address }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      return [];
    }
    throw error;
  }
}

/**
 * Resolve AAAA records for a domain
 */
export async function resolveAAAARecords(domain: string): Promise<IDnsAAAARecord[]> {
  try {
    const addresses = await dns.resolve6(domain);
    return addresses.map(address => ({ address }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      return [];
    }
    throw error;
  }
}

/**
 * Resolve MX records for a domain
 */
export async function resolveMxRecords(domain: string): Promise<IDnsMxRecord[]> {
  try {
    const records = await dns.resolveMx(domain);
    return records.map(r => ({
      exchange: r.exchange,
      priority: r.priority,
    })).sort((a, b) => a.priority - b.priority);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      return [];
    }
    throw error;
  }
}

/**
 * Resolve NS records for a domain
 */
export async function resolveNsRecords(domain: string): Promise<IDnsNsRecord[]> {
  try {
    const records = await dns.resolveNs(domain);
    return records.map(value => ({ value }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      return [];
    }
    throw error;
  }
}

/**
 * Resolve TXT records for a domain
 */
export async function resolveTxtRecords(domain: string): Promise<IDnsTxtRecord[]> {
  try {
    const records = await dns.resolveTxt(domain);
    return records.map(value => ({ value }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      return [];
    }
    throw error;
  }
}

/**
 * Resolve SOA record for a domain
 */
export async function resolveSoaRecord(domain: string): Promise<IDnsSoaRecord | null> {
  try {
    const record = await dns.resolveSoa(domain);
    return {
      nsname: record.nsname,
      hostmaster: record.hostmaster,
      serial: record.serial,
      refresh: record.refresh,
      retry: record.retry,
      expire: record.expire,
      minttl: record.minttl,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve CNAME record for a domain
 */
export async function resolveCnameRecords(domain: string): Promise<IDnsCnameRecord[]> {
  try {
    const records = await dns.resolveCname(domain);
    return records.map(value => ({ value }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      return [];
    }
    throw error;
  }
}

/**
 * Get all DNS records for a domain
 */
export async function getAllDnsRecords(domain: string): Promise<IDnsRecords> {
  const [a, aaaa, mx, ns, txt, soa, cname] = await Promise.allSettled([
    resolveARecords(domain),
    resolveAAAARecords(domain),
    resolveMxRecords(domain),
    resolveNsRecords(domain),
    resolveTxtRecords(domain),
    resolveSoaRecord(domain),
    resolveCnameRecords(domain),
  ]);

  return {
    a: a.status === 'fulfilled' ? a.value : [],
    aaaa: aaaa.status === 'fulfilled' ? aaaa.value : [],
    mx: mx.status === 'fulfilled' ? mx.value : [],
    ns: ns.status === 'fulfilled' ? ns.value : [],
    txt: txt.status === 'fulfilled' ? txt.value : [],
    soa: soa.status === 'fulfilled' ? soa.value : null,
    cname: cname.status === 'fulfilled' ? cname.value : [],
  };
}

/**
 * Check SPF record for a domain
 */
export async function checkSpfRecord(domain: string): Promise<ISpfRecord> {
  const txtRecords = await resolveTxtRecords(domain);
  const spfRecord = txtRecords.find(r =>
    r.value.some(v => v.startsWith('v=spf1'))
  );

  if (!spfRecord) {
    return { present: false };
  }

  const spfText = spfRecord.value.join('');
  const result: ISpfRecord = {
    present: true,
    record: spfText,
    includes: [],
    ip4: [],
    ip6: [],
  };

  // Parse SPF mechanisms
  const mechanisms = spfText.split(' ');

  for (const mech of mechanisms) {
    if (mech.startsWith('include:')) {
      result.includes!.push(mech.replace('include:', ''));
    } else if (mech.startsWith('ip4:')) {
      result.ip4!.push(mech.replace('ip4:', ''));
    } else if (mech.startsWith('ip6:')) {
      result.ip6!.push(mech.replace('ip6:', ''));
    } else if (mech === '+all') {
      result.all = '+all';
      result.policy = 'pass';
    } else if (mech === '-all') {
      result.all = '-all';
      result.policy = 'fail';
    } else if (mech === '~all') {
      result.all = '~all';
      result.policy = 'softfail';
    } else if (mech === '?all') {
      result.all = '?all';
      result.policy = 'neutral';
    }
  }

  // Default policy if no all mechanism found
  if (!result.policy) {
    result.policy = 'none';
  }

  return result;
}

/**
 * Check DMARC record for a domain
 */
export async function checkDmarcRecord(domain: string): Promise<IDmarcRecord> {
  try {
    const dmarcDomain = `_dmarc.${domain}`;
    const txtRecords = await resolveTxtRecords(dmarcDomain);
    const dmarcRecord = txtRecords.find(r =>
      r.value.some(v => v.startsWith('v=DMARC1'))
    );

    if (!dmarcRecord) {
      return { present: false };
    }

    const dmarcText = dmarcRecord.value.join('');
    const result: IDmarcRecord = {
      present: true,
      record: dmarcText,
      rua: [],
      ruf: [],
    };

    // Parse DMARC tags
    const tags = dmarcText.split(';').map(t => t.trim());

    for (const tag of tags) {
      const [key, value] = tag.split('=').map(s => s.trim());

      switch (key) {
        case 'p':
          result.policy = value as 'none' | 'quarantine' | 'reject';
          break;
        case 'sp':
          result.subdomain_policy = value as 'none' | 'quarantine' | 'reject';
          break;
        case 'pct':
          result.pct = parseInt(value, 10);
          break;
        case 'rua':
          result.rua = value.split(',').map(s => s.trim());
          break;
        case 'ruf':
          result.ruf = value.split(',').map(s => s.trim());
          break;
      }
    }

    return result;
  } catch (error) {
    return { present: false };
  }
}

/**
 * Check DKIM record for a domain with a specific selector
 */
export async function checkDkimSelector(
  domain: string,
  selector: string
): Promise<IDkimRecord> {
  try {
    const dkimDomain = `${selector}._domainkey.${domain}`;
    const txtRecords = await resolveTxtRecords(dkimDomain);

    if (txtRecords.length === 0) {
      return { present: false, selector };
    }

    const dkimText = txtRecords[0].value.join('');
    const result: IDkimRecord = {
      present: true,
      selector,
      record: dkimText,
    };

    // Check for key type
    if (dkimText.includes('k=rsa')) {
      result.key_type = 'rsa';
    } else if (dkimText.includes('k=ed25519')) {
      result.key_type = 'ed25519';
    }

    return result;
  } catch (error) {
    return { present: false, selector };
  }
}

/**
 * Check DKIM records for a domain using common selectors
 */
export async function checkDkimRecords(domain: string): Promise<IDkimRecord[]> {
  const results = await Promise.allSettled(
    COMMON_DKIM_SELECTORS.map(selector => checkDkimSelector(domain, selector))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<IDkimRecord> =>
      r.status === 'fulfilled' && r.value.present
    )
    .map(r => r.value);
}

/**
 * Get complete email security report for a domain
 */
export async function getEmailSecurityReport(domain: string): Promise<IEmailSecurityReport> {
  const [spf, dmarc, dkim] = await Promise.all([
    checkSpfRecord(domain),
    checkDmarcRecord(domain),
    checkDkimRecords(domain),
  ]);

  return { spf, dmarc, dkim };
}

/**
 * Check HTTP security headers for a URL
 */
export async function checkHttpSecurityHeaders(url: string): Promise<IHttpHeadersReport> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const securityHeaders: ISecurityHeaders = {
      'strict-transport-security': headers['strict-transport-security'],
      'content-security-policy': headers['content-security-policy'],
      'x-frame-options': headers['x-frame-options'],
      'x-content-type-options': headers['x-content-type-options'],
      'x-xss-protection': headers['x-xss-protection'],
      'referrer-policy': headers['referrer-policy'],
      'permissions-policy': headers['permissions-policy'],
      server: headers['server'],
      'x-powered-by': headers['x-powered-by'],
    };

    // Find missing security headers
    const missingHeaders = REQUIRED_SECURITY_HEADERS.filter(
      h => !securityHeaders[h as keyof ISecurityHeaders]
    );

    // Extract technology hints
    const technologyHints: string[] = [];
    if (headers['server']) {
      technologyHints.push(headers['server']);
    }
    if (headers['x-powered-by']) {
      technologyHints.push(headers['x-powered-by']);
    }

    return {
      status_code: response.status,
      headers,
      security_headers: securityHeaders,
      missing_security_headers: missingHeaders,
      server_info: headers['server'],
      technology_hints: technologyHints.length > 0 ? technologyHints : undefined,
    };
  } catch (error) {
    throw new Error(`Failed to fetch headers: ${(error as Error).message}`);
  }
}

/**
 * Resolve hostname to IP addresses
 */
export async function resolveHostToIps(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.allSettled([
    resolveARecords(hostname),
    resolveAAAARecords(hostname),
  ]);

  const ips: string[] = [];

  if (v4.status === 'fulfilled') {
    ips.push(...v4.value.map(r => r.address));
  }

  if (v6.status === 'fulfilled') {
    ips.push(...v6.value.map(r => r.address));
  }

  return ips;
}

/**
 * Check if a subdomain exists by attempting DNS resolution
 */
export async function checkSubdomainExists(subdomain: string): Promise<boolean> {
  try {
    const ips = await resolveHostToIps(subdomain);
    return ips.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Cloud storage bucket patterns for detection
 * These patterns are used to check for public cloud storage exposure
 */
export const CLOUD_STORAGE_PATTERNS = {
  s3: [
    `{bucket}.s3.amazonaws.com`,
    `{bucket}.s3-{region}.amazonaws.com`,
    `s3.amazonaws.com/{bucket}`,
    `s3-{region}.amazonaws.com/{bucket}`,
  ],
  azure: [
    `{bucket}.blob.core.windows.net`,
  ],
  gcs: [
    `storage.googleapis.com/{bucket}`,
    `{bucket}.storage.googleapis.com`,
  ],
};

/**
 * Generate potential cloud storage bucket names based on domain
 */
export function generateBucketNames(domain: string): string[] {
  const domainParts = domain.split('.');
  const baseName = domainParts[0];

  const bucketVariants: string[] = [
    domain.replace(/\./g, '-'),
    baseName,
    `${baseName}-backup`,
    `${baseName}-backups`,
    `${baseName}-assets`,
    `${baseName}-static`,
    `${baseName}-media`,
    `${baseName}-uploads`,
    `${baseName}-files`,
    `${baseName}-data`,
    `${baseName}-public`,
    `${baseName}-private`,
    `${baseName}-dev`,
    `${baseName}-prod`,
    `${baseName}-staging`,
  ];

  return bucketVariants;
}

/**
 * Check if an S3 bucket is publicly accessible
 */
export async function checkS3BucketAccess(bucketName: string): Promise<{
  accessible: boolean;
  listable: boolean;
  url: string;
}> {
  const url = `https://${bucketName}.s3.amazonaws.com`;

  try {
    const response = await fetch(url, { method: 'GET' });

    // Check for listing access
    const text = await response.text();
    const isListable = text.includes('<ListBucketResult') || text.includes('<Contents>');

    return {
      accessible: response.status !== 404,
      listable: isListable,
      url,
    };
  } catch (error) {
    return {
      accessible: false,
      listable: false,
      url,
    };
  }
}

/**
 * Check if an Azure blob container is publicly accessible
 */
export async function checkAzureBlobAccess(containerName: string): Promise<{
  accessible: boolean;
  listable: boolean;
  url: string;
}> {
  const url = `https://${containerName}.blob.core.windows.net`;

  try {
    const response = await fetch(`${url}?restype=container&comp=list`, { method: 'GET' });

    return {
      accessible: response.status !== 404,
      listable: response.status === 200,
      url,
    };
  } catch (error) {
    return {
      accessible: false,
      listable: false,
      url,
    };
  }
}

/**
 * Check if a GCS bucket is publicly accessible
 */
export async function checkGcsBucketAccess(bucketName: string): Promise<{
  accessible: boolean;
  listable: boolean;
  url: string;
}> {
  const url = `https://storage.googleapis.com/${bucketName}`;

  try {
    const response = await fetch(url, { method: 'GET' });

    // Check for listing access
    const text = await response.text();
    const isListable = text.includes('<ListBucketResult') || text.includes('<Contents>');

    return {
      accessible: response.status !== 404,
      listable: isListable,
      url,
    };
  } catch (error) {
    return {
      accessible: false,
      listable: false,
      url,
    };
  }
}

// ===================================================================
// Subdomain Discovery (F109-F111)
// ===================================================================

/**
 * Discovered subdomain result
 */
export interface ISubdomainResult {
  subdomain: string;
  source: 'dns_brute' | 'crt_sh' | 'zone_transfer';
  ip_addresses: string[];
  discovered_at: Date;
}

/**
 * Common subdomain prefixes for brute force discovery
 * (F109: top 5000 wordlist - this is a representative subset)
 */
const COMMON_SUBDOMAIN_PREFIXES = [
  // Primary services
  'www', 'mail', 'ftp', 'localhost', 'webmail', 'smtp', 'pop', 'ns1', 'ns2',
  'ns3', 'ns4', 'dns', 'dns1', 'dns2', 'mx', 'mx1', 'mx2', 'email',
  // Development/Staging
  'dev', 'development', 'staging', 'stage', 'test', 'testing', 'qa', 'uat',
  'sandbox', 'demo', 'preview', 'beta', 'alpha', 'prod', 'production',
  // Infrastructure
  'api', 'api1', 'api2', 'api-dev', 'api-staging', 'api-prod', 'gateway',
  'cdn', 'static', 'assets', 'media', 'img', 'images', 'files', 'download',
  'upload', 'cloud', 's3', 'storage', 'bucket', 'blob', 'data',
  // Applications
  'app', 'apps', 'portal', 'admin', 'administrator', 'dashboard', 'panel',
  'cpanel', 'plesk', 'whm', 'webadmin', 'control', 'manage', 'manager',
  'cms', 'blog', 'forum', 'wiki', 'docs', 'documentation', 'help', 'support',
  'ticket', 'tickets', 'helpdesk', 'kb', 'knowledgebase',
  // Security/Auth
  'auth', 'login', 'signin', 'signup', 'sso', 'oauth', 'identity', 'id',
  'secure', 'security', 'vpn', 'remote', 'rdp', 'ssh', 'ssl',
  // Communication
  'chat', 'slack', 'teams', 'meet', 'meeting', 'video', 'voice', 'sip',
  'pbx', 'voip', 'call', 'conference', 'webex', 'zoom',
  // Database/Backend
  'db', 'database', 'mysql', 'postgres', 'postgresql', 'mongodb', 'mongo',
  'redis', 'elastic', 'elasticsearch', 'kibana', 'grafana', 'prometheus',
  // Monitoring
  'status', 'monitor', 'monitoring', 'nagios', 'zabbix', 'datadog', 'newrelic',
  'splunk', 'logs', 'log', 'syslog', 'metrics', 'stats', 'analytics',
  // CI/CD
  'git', 'gitlab', 'github', 'bitbucket', 'jenkins', 'ci', 'cd', 'build',
  'deploy', 'release', 'artifactory', 'nexus', 'sonar', 'sonarqube',
  // Networking
  'proxy', 'reverse-proxy', 'lb', 'loadbalancer', 'haproxy', 'nginx',
  'apache', 'firewall', 'waf', 'router', 'switch', 'gateway',
  // Geographic/Regional
  'us', 'eu', 'uk', 'asia', 'ap', 'na', 'sa', 'east', 'west', 'north', 'south',
  'us-east', 'us-west', 'eu-west', 'eu-central', 'ap-south', 'ap-northeast',
  // Numbered variants
  'server1', 'server2', 'server3', 'host1', 'host2', 'web1', 'web2', 'web3',
  'node1', 'node2', 'node3', 'cluster1', 'cluster2', 'worker1', 'worker2',
  // Internal
  'internal', 'intranet', 'extranet', 'corp', 'corporate', 'office', 'hq',
  'private', 'local', 'lan', 'home', 'backup', 'bak', 'old', 'legacy',
  // Misc
  'shop', 'store', 'ecommerce', 'cart', 'checkout', 'payment', 'pay',
  'billing', 'invoice', 'crm', 'erp', 'hr', 'payroll', 'finance', 'accounting',
];

/**
 * Perform DNS brute force subdomain discovery
 * (F109: Subdomain discovery via DNS brute force)
 *
 * @param domain - The root domain to scan
 * @param prefixes - Optional custom prefix list (defaults to COMMON_SUBDOMAIN_PREFIXES)
 * @param concurrency - Number of concurrent DNS queries (default: 10)
 */
export async function discoverSubdomainsDnsBrute(
  domain: string,
  prefixes: string[] = COMMON_SUBDOMAIN_PREFIXES,
  concurrency: number = 10
): Promise<ISubdomainResult[]> {
  const results: ISubdomainResult[] = [];
  const discovered = new Set<string>();

  // Process in batches for controlled concurrency
  for (let i = 0; i < prefixes.length; i += concurrency) {
    const batch = prefixes.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(async (prefix) => {
        const subdomain = `${prefix}.${domain}`;

        // Skip if already discovered
        if (discovered.has(subdomain)) {
          return null;
        }

        try {
          const aRecords = await resolveARecords(subdomain);
          if (aRecords.length > 0) {
            discovered.add(subdomain);
            return {
              subdomain,
              source: 'dns_brute' as const,
              ip_addresses: aRecords.map(r => r.address),
              discovered_at: new Date(),
            };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    // Collect successful results
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }
  }

  return results;
}

/**
 * Query Certificate Transparency logs via crt.sh
 * (F110: Subdomain discovery via Certificate Transparency logs)
 *
 * @param domain - The root domain to query
 */
export async function discoverSubdomainsCrtSh(domain: string): Promise<ISubdomainResult[]> {
  const results: ISubdomainResult[] = [];
  const discovered = new Set<string>();

  try {
    // Query crt.sh API for certificates
    const response = await fetch(
      `https://crt.sh/?q=%.${encodeURIComponent(domain)}&output=json`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.warn(`crt.sh query failed: ${response.status}`);
      return results;
    }

    const certificates = await response.json() as Array<{
      name_value: string;
      common_name?: string;
    }>;

    // Extract unique subdomains from certificates
    for (const cert of certificates) {
      // name_value may contain multiple names separated by newlines
      const names = (cert.name_value || '').split('\n');

      for (const name of names) {
        const cleanName = name.trim().toLowerCase();

        // Skip if not a subdomain of the target domain
        if (!cleanName.endsWith(`.${domain}`) && cleanName !== domain) {
          continue;
        }

        // Skip wildcards
        if (cleanName.startsWith('*.')) {
          continue;
        }

        // Skip if already found
        if (discovered.has(cleanName)) {
          continue;
        }

        discovered.add(cleanName);

        // Resolve IP addresses for the subdomain
        let ipAddresses: string[] = [];
        try {
          const aRecords = await resolveARecords(cleanName);
          ipAddresses = aRecords.map(r => r.address);
        } catch {
          // DNS resolution may fail for historical certificates
        }

        results.push({
          subdomain: cleanName,
          source: 'crt_sh',
          ip_addresses: ipAddresses,
          discovered_at: new Date(),
        });
      }
    }
  } catch (error) {
    console.error('crt.sh discovery failed:', error);
  }

  return results;
}

/**
 * Attempt DNS zone transfer (AXFR)
 * (F111: Attempt DNS zone transfer)
 *
 * Note: Zone transfers are rarely allowed on public DNS servers,
 * but when successful they reveal all DNS records for a zone.
 * This function attempts AXFR against the domain's nameservers.
 *
 * @param domain - The domain to attempt zone transfer on
 */
export async function attemptZoneTransfer(domain: string): Promise<{
  success: boolean;
  nameservers: string[];
  subdomains: ISubdomainResult[];
  error?: string;
}> {
  try {
    // Get nameservers for the domain
    const nsRecords = await resolveNsRecords(domain);

    if (nsRecords.length === 0) {
      return {
        success: false,
        nameservers: [],
        subdomains: [],
        error: 'No nameservers found for domain',
      };
    }

    const nameservers = nsRecords.map(r => r.value);

    // Note: Node.js dns module doesn't support AXFR directly.
    // Zone transfers require a TCP connection and the AXFR protocol.
    // In a production implementation, this would use a library like
    // 'dns-packet' with a TCP connection, or shell out to 'dig axfr'.
    //
    // For now, we return that zone transfer is not implemented in TypeScript,
    // and this feature would be handled by the scanner pod with proper tooling.

    return {
      success: false,
      nameservers,
      subdomains: [],
      error: 'Zone transfer (AXFR) requires scanner pod with dig/nmap tooling',
    };
  } catch (error) {
    return {
      success: false,
      nameservers: [],
      subdomains: [],
      error: error instanceof Error ? error.message : 'Zone transfer failed',
    };
  }
}

/**
 * Comprehensive subdomain discovery combining multiple sources
 *
 * @param domain - The domain to scan for subdomains
 * @param options - Discovery options
 */
export async function discoverSubdomains(
  domain: string,
  options: {
    useDnsBrute?: boolean;
    useCrtSh?: boolean;
    attemptZoneTransfer?: boolean;
    customPrefixes?: string[];
    concurrency?: number;
  } = {}
): Promise<{
  subdomains: ISubdomainResult[];
  sources_used: string[];
  zone_transfer_attempted: boolean;
}> {
  const {
    useDnsBrute = true,
    useCrtSh = true,
    attemptZoneTransfer: tryAxfr = false,
    customPrefixes,
    concurrency = 10,
  } = options;

  const allSubdomains: ISubdomainResult[] = [];
  const sourcesUsed: string[] = [];
  const seen = new Set<string>();

  // Helper to deduplicate results
  const addResults = (results: ISubdomainResult[]) => {
    for (const result of results) {
      if (!seen.has(result.subdomain)) {
        seen.add(result.subdomain);
        allSubdomains.push(result);
      }
    }
  };

  // Run discovery methods in parallel where possible
  const discoveries = await Promise.allSettled([
    useCrtSh
      ? discoverSubdomainsCrtSh(domain).then((r) => {
          sourcesUsed.push('crt_sh');
          return r;
        })
      : Promise.resolve([]),
    useDnsBrute
      ? discoverSubdomainsDnsBrute(domain, customPrefixes, concurrency).then((r) => {
          sourcesUsed.push('dns_brute');
          return r;
        })
      : Promise.resolve([]),
  ]);

  for (const result of discoveries) {
    if (result.status === 'fulfilled') {
      addResults(result.value);
    }
  }

  // Zone transfer is attempted separately (usually fails)
  let zoneTransferAttempted = false;
  if (tryAxfr) {
    zoneTransferAttempted = true;
    const zoneResult = await attemptZoneTransfer(domain);
    if (zoneResult.success) {
      sourcesUsed.push('zone_transfer');
      addResults(zoneResult.subdomains);
    }
  }

  // Sort by subdomain name
  allSubdomains.sort((a, b) => a.subdomain.localeCompare(b.subdomain));

  return {
    subdomains: allSubdomains,
    sources_used: sourcesUsed,
    zone_transfer_attempted: zoneTransferAttempted,
  };
}
