'use server';

/**
 * CVE Integration Module
 *
 * Provides integration with:
 * - NVD (National Vulnerability Database) API for CVE lookups
 * - FIRST.org EPSS API for exploit probability scores
 * - Service-to-CPE mapping for vulnerability correlation
 */

// Types
export interface ICveRecord {
  cve_id: string;
  description: string;
  cvss_v3_score?: number;
  cvss_v3_vector?: string;
  cvss_v3_severity?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cvss_v2_score?: number;
  published_date: string;
  last_modified_date: string;
  references: string[];
  affected_products: ICpeMatch[];
}

export interface ICpeMatch {
  cpe23_uri: string;
  vulnerable: boolean;
  version_start_including?: string;
  version_end_including?: string;
  version_start_excluding?: string;
  version_end_excluding?: string;
}

export interface IEpssScore {
  cve_id: string;
  epss: number; // 0.0 to 1.0
  percentile: number; // 0.0 to 100.0
  date: string;
}

export interface INvdSearchParams {
  keyword?: string;
  cpe_name?: string;
  cve_id?: string;
  cvss_v3_severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  start_index?: number;
  results_per_page?: number;
}

export interface INvdSearchResponse {
  results_per_page: number;
  start_index: number;
  total_results: number;
  vulnerabilities: ICveRecord[];
}

// Common service to CPE mappings
// CPE format: cpe:2.3:a:vendor:product:version:update:edition:language:sw_edition:target_sw:target_hw:other
export const SERVICE_TO_CPE_MAPPINGS: Record<string, string[]> = {
  // Web Servers
  'apache': ['cpe:2.3:a:apache:http_server'],
  'apache/2': ['cpe:2.3:a:apache:http_server:2'],
  'nginx': ['cpe:2.3:a:f5:nginx', 'cpe:2.3:a:nginx:nginx'],
  'nginx/1': ['cpe:2.3:a:f5:nginx:1', 'cpe:2.3:a:nginx:nginx:1'],
  'microsoft-iis': ['cpe:2.3:a:microsoft:internet_information_services'],
  'iis': ['cpe:2.3:a:microsoft:internet_information_services'],
  'lighttpd': ['cpe:2.3:a:lighttpd:lighttpd'],

  // Application Servers
  'tomcat': ['cpe:2.3:a:apache:tomcat'],
  'jetty': ['cpe:2.3:a:eclipse:jetty'],
  'weblogic': ['cpe:2.3:a:oracle:weblogic_server'],
  'jboss': ['cpe:2.3:a:redhat:jboss_enterprise_application_platform'],
  'wildfly': ['cpe:2.3:a:redhat:wildfly'],

  // Databases
  'mysql': ['cpe:2.3:a:oracle:mysql', 'cpe:2.3:a:mysql:mysql'],
  'mariadb': ['cpe:2.3:a:mariadb:mariadb'],
  'postgresql': ['cpe:2.3:a:postgresql:postgresql'],
  'mongodb': ['cpe:2.3:a:mongodb:mongodb'],
  'redis': ['cpe:2.3:a:redis:redis'],
  'elasticsearch': ['cpe:2.3:a:elastic:elasticsearch'],
  'mssql': ['cpe:2.3:a:microsoft:sql_server'],
  'oracle': ['cpe:2.3:a:oracle:database_server'],

  // Mail Servers
  'postfix': ['cpe:2.3:a:postfix:postfix'],
  'exim': ['cpe:2.3:a:exim:exim'],
  'sendmail': ['cpe:2.3:a:sendmail:sendmail'],
  'exchange': ['cpe:2.3:a:microsoft:exchange_server'],

  // SSH/Remote Access
  'openssh': ['cpe:2.3:a:openbsd:openssh'],
  'dropbear': ['cpe:2.3:a:dropbear_ssh_project:dropbear_ssh'],

  // FTP
  'vsftpd': ['cpe:2.3:a:vsftpd:vsftpd'],
  'proftpd': ['cpe:2.3:a:proftpd:proftpd'],
  'pureftpd': ['cpe:2.3:a:pureftpd:pure-ftpd'],

  // DNS
  'bind': ['cpe:2.3:a:isc:bind'],
  'named': ['cpe:2.3:a:isc:bind'],
  'powerdns': ['cpe:2.3:a:powerdns:powerdns'],
  'dnsmasq': ['cpe:2.3:a:thekelleys:dnsmasq'],

  // Frameworks
  'express': ['cpe:2.3:a:expressjs:express'],
  'django': ['cpe:2.3:a:djangoproject:django'],
  'rails': ['cpe:2.3:a:rubyonrails:ruby_on_rails'],
  'laravel': ['cpe:2.3:a:laravel:laravel'],
  'spring': ['cpe:2.3:a:vmware:spring_framework'],
  'struts': ['cpe:2.3:a:apache:struts'],

  // CMS
  'wordpress': ['cpe:2.3:a:wordpress:wordpress'],
  'drupal': ['cpe:2.3:a:drupal:drupal'],
  'joomla': ['cpe:2.3:a:joomla:joomla\\!'],
  'magento': ['cpe:2.3:a:magento:magento'],

  // Programming Languages/Runtimes
  'php': ['cpe:2.3:a:php:php'],
  'node': ['cpe:2.3:a:nodejs:node.js'],
  'nodejs': ['cpe:2.3:a:nodejs:node.js'],
  'python': ['cpe:2.3:a:python:python'],
  'java': ['cpe:2.3:a:oracle:jdk', 'cpe:2.3:a:oracle:jre'],
  'ruby': ['cpe:2.3:a:ruby-lang:ruby'],

  // Container/Orchestration
  'docker': ['cpe:2.3:a:docker:docker'],
  'kubernetes': ['cpe:2.3:a:kubernetes:kubernetes'],

  // Proxy/Load Balancers
  'haproxy': ['cpe:2.3:a:haproxy:haproxy'],
  'varnish': ['cpe:2.3:a:varnish-software:varnish_cache'],
  'squid': ['cpe:2.3:a:squid-cache:squid'],
};

// NVD API configuration
const NVD_API_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const EPSS_API_BASE = 'https://api.first.org/data/v1/epss';

// Rate limiting for NVD API (5 requests per 30 seconds without API key)
let lastNvdRequest = 0;
const NVD_RATE_LIMIT_MS = 6000; // 6 seconds between requests

/**
 * Reset rate limiter (for testing)
 */
export function resetNvdRateLimiter(): void {
  lastNvdRequest = 0;
}

/**
 * Wait for NVD rate limit
 */
async function waitForNvdRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastNvdRequest;
  if (timeSinceLastRequest < NVD_RATE_LIMIT_MS) {
    await new Promise(resolve =>
      setTimeout(resolve, NVD_RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }
  lastNvdRequest = Date.now();
}

/**
 * Map service banner to CPE strings
 */
export function mapServiceToCpe(serviceBanner: string): string[] {
  const banner = serviceBanner.toLowerCase();
  const matches: string[] = [];

  // Try to extract version number
  const versionMatch = banner.match(/(\d+(?:\.\d+)*)/);
  const version = versionMatch ? versionMatch[1] : null;

  // Check against known mappings
  for (const [pattern, cpes] of Object.entries(SERVICE_TO_CPE_MAPPINGS)) {
    if (banner.includes(pattern)) {
      for (const cpe of cpes) {
        if (version) {
          // Append version to CPE
          const parts = cpe.split(':');
          if (parts.length >= 5) {
            parts[5] = version.split('.')[0]; // Major version
            matches.push(parts.join(':'));
          }
        }
        matches.push(cpe);
      }
    }
  }

  return [...new Set(matches)]; // Remove duplicates
}

/**
 * Parse NVD API response into CVE records
 */
function parseNvdResponse(data: unknown): ICveRecord[] {
  const response = data as {
    vulnerabilities?: Array<{
      cve: {
        id: string;
        descriptions: Array<{ lang: string; value: string }>;
        published: string;
        lastModified: string;
        metrics?: {
          cvssMetricV31?: Array<{
            cvssData: {
              baseScore: number;
              vectorString: string;
              baseSeverity: string;
            };
          }>;
          cvssMetricV2?: Array<{
            cvssData: {
              baseScore: number;
            };
          }>;
        };
        references?: Array<{ url: string }>;
        configurations?: Array<{
          nodes: Array<{
            cpeMatch: Array<{
              criteria: string;
              vulnerable: boolean;
              versionStartIncluding?: string;
              versionEndIncluding?: string;
              versionStartExcluding?: string;
              versionEndExcluding?: string;
            }>;
          }>;
        }>;
      };
    }>;
  };

  if (!response.vulnerabilities) {
    return [];
  }

  return response.vulnerabilities.map(vuln => {
    const cve = vuln.cve;
    const description = cve.descriptions.find(d => d.lang === 'en')?.value || '';
    const cvssV31 = cve.metrics?.cvssMetricV31?.[0]?.cvssData;
    const cvssV2 = cve.metrics?.cvssMetricV2?.[0]?.cvssData;

    const affectedProducts: ICpeMatch[] = [];
    if (cve.configurations) {
      for (const config of cve.configurations) {
        for (const node of config.nodes) {
          for (const match of node.cpeMatch) {
            affectedProducts.push({
              cpe23_uri: match.criteria,
              vulnerable: match.vulnerable,
              version_start_including: match.versionStartIncluding,
              version_end_including: match.versionEndIncluding,
              version_start_excluding: match.versionStartExcluding,
              version_end_excluding: match.versionEndExcluding,
            });
          }
        }
      }
    }

    return {
      cve_id: cve.id,
      description,
      cvss_v3_score: cvssV31?.baseScore,
      cvss_v3_vector: cvssV31?.vectorString,
      cvss_v3_severity: cvssV31?.baseSeverity as ICveRecord['cvss_v3_severity'],
      cvss_v2_score: cvssV2?.baseScore,
      published_date: cve.published,
      last_modified_date: cve.lastModified,
      references: cve.references?.map(r => r.url) || [],
      affected_products: affectedProducts,
    };
  });
}

/**
 * Search NVD for CVEs matching criteria
 */
export async function searchNvdCves(
  params: INvdSearchParams,
  apiKey?: string
): Promise<INvdSearchResponse> {
  await waitForNvdRateLimit();

  const url = new URL(NVD_API_BASE);

  if (params.keyword) {
    url.searchParams.set('keywordSearch', params.keyword);
  }
  if (params.cpe_name) {
    url.searchParams.set('cpeName', params.cpe_name);
  }
  if (params.cve_id) {
    url.searchParams.set('cveId', params.cve_id);
  }
  if (params.cvss_v3_severity) {
    url.searchParams.set('cvssV3Severity', params.cvss_v3_severity);
  }
  if (params.start_index !== undefined) {
    url.searchParams.set('startIndex', params.start_index.toString());
  }
  if (params.results_per_page !== undefined) {
    url.searchParams.set('resultsPerPage', params.results_per_page.toString());
  }

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (apiKey) {
    headers['apiKey'] = apiKey;
  }

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    throw new Error(`NVD API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const typedData = data as {
    resultsPerPage: number;
    startIndex: number;
    totalResults: number;
  };

  return {
    results_per_page: typedData.resultsPerPage,
    start_index: typedData.startIndex,
    total_results: typedData.totalResults,
    vulnerabilities: parseNvdResponse(data),
  };
}

/**
 * Get CVE details by CVE ID
 */
export async function getCveById(
  cveId: string,
  apiKey?: string
): Promise<ICveRecord | null> {
  const result = await searchNvdCves({ cve_id: cveId }, apiKey);
  return result.vulnerabilities[0] || null;
}

/**
 * Get CVEs for a CPE (product identifier)
 */
export async function getCvesForCpe(
  cpeName: string,
  apiKey?: string
): Promise<ICveRecord[]> {
  const result = await searchNvdCves({ cpe_name: cpeName }, apiKey);
  return result.vulnerabilities;
}

/**
 * Get CVEs for a service banner
 */
export async function getCvesForService(
  serviceBanner: string,
  apiKey?: string
): Promise<ICveRecord[]> {
  const cpes = mapServiceToCpe(serviceBanner);

  if (cpes.length === 0) {
    return [];
  }

  const allCves: ICveRecord[] = [];
  const seenIds = new Set<string>();

  for (const cpe of cpes) {
    try {
      const cves = await getCvesForCpe(cpe, apiKey);
      for (const cve of cves) {
        if (!seenIds.has(cve.cve_id)) {
          seenIds.add(cve.cve_id);
          allCves.push(cve);
        }
      }
    } catch (error) {
      console.error(`Error fetching CVEs for CPE ${cpe}:`, error);
    }
  }

  // Sort by CVSS score descending
  return allCves.sort((a, b) => (b.cvss_v3_score || 0) - (a.cvss_v3_score || 0));
}

/**
 * Get EPSS score for a CVE
 */
export async function getEpssScore(cveId: string): Promise<IEpssScore | null> {
  const url = `${EPSS_API_BASE}?cve=${cveId}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`EPSS API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    status: string;
    data?: Array<{
      cve: string;
      epss: string;
      percentile: string;
      date: string;
    }>;
  };

  if (data.status !== 'OK' || !data.data || data.data.length === 0) {
    return null;
  }

  const epssData = data.data[0];
  return {
    cve_id: epssData.cve,
    epss: parseFloat(epssData.epss),
    percentile: parseFloat(epssData.percentile) * 100, // Convert to percentage
    date: epssData.date,
  };
}

/**
 * Get EPSS scores for multiple CVEs
 */
export async function getEpssScores(cveIds: string[]): Promise<Map<string, IEpssScore>> {
  const results = new Map<string, IEpssScore>();

  if (cveIds.length === 0) {
    return results;
  }

  // EPSS API supports up to 30 CVEs per request
  const batchSize = 30;
  for (let i = 0; i < cveIds.length; i += batchSize) {
    const batch = cveIds.slice(i, i + batchSize);
    const url = `${EPSS_API_BASE}?cve=${batch.join(',')}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      const data = await response.json() as {
        status: string;
        data?: Array<{
          cve: string;
          epss: string;
          percentile: string;
          date: string;
        }>;
      };

      if (data.status === 'OK' && data.data) {
        for (const item of data.data) {
          results.set(item.cve, {
            cve_id: item.cve,
            epss: parseFloat(item.epss),
            percentile: parseFloat(item.percentile) * 100,
            date: item.date,
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching EPSS scores for batch:`, error);
    }
  }

  return results;
}

/**
 * Enrich CVE records with EPSS scores
 */
export async function enrichCvesWithEpss(cves: ICveRecord[]): Promise<Array<ICveRecord & { epss?: IEpssScore }>> {
  const cveIds = cves.map(c => c.cve_id);
  const epssScores = await getEpssScores(cveIds);

  return cves.map(cve => ({
    ...cve,
    epss: epssScores.get(cve.cve_id),
  }));
}

/**
 * Get severity level from CVSS score
 */
export function getCvssSeverity(score: number | undefined): string {
  if (score === undefined || score === null) {
    return 'UNKNOWN';
  }
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score >= 0.1) return 'LOW';
  return 'NONE';
}

/**
 * Check if a version is affected by a CVE based on version constraints
 */
export function isVersionAffected(
  version: string,
  match: ICpeMatch
): boolean {
  if (!match.vulnerable) {
    return false;
  }

  // Simple version comparison (could be enhanced with proper semver)
  const versionParts = version.split('.').map(p => parseInt(p, 10) || 0);

  const compareVersions = (v1: number[], v2: string): number => {
    const v2Parts = v2.split('.').map(p => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(v1.length, v2Parts.length); i++) {
      const p1 = v1[i] || 0;
      const p2 = v2Parts[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    return 0;
  };

  // Check version constraints
  if (match.version_start_including) {
    if (compareVersions(versionParts, match.version_start_including) < 0) {
      return false;
    }
  }

  if (match.version_start_excluding) {
    if (compareVersions(versionParts, match.version_start_excluding) <= 0) {
      return false;
    }
  }

  if (match.version_end_including) {
    if (compareVersions(versionParts, match.version_end_including) > 0) {
      return false;
    }
  }

  if (match.version_end_excluding) {
    if (compareVersions(versionParts, match.version_end_excluding) >= 0) {
      return false;
    }
  }

  return true;
}
