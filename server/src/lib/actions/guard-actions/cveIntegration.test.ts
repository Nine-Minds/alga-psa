import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  mapServiceToCpe,
  searchNvdCves,
  getCveById,
  getCvesForCpe,
  getEpssScore,
  getEpssScores,
  enrichCvesWithEpss,
  getCvssSeverity,
  isVersionAffected,
  SERVICE_TO_CPE_MAPPINGS,
  resetNvdRateLimiter,
} from './cveIntegration';

describe('CVE Integration - Service to CPE Mapping', () => {
  describe('mapServiceToCpe', () => {
    it('should map Apache HTTP Server banner to CPE', () => {
      const cpes = mapServiceToCpe('Apache/2.4.41 (Ubuntu)');

      expect(cpes.some(c => c.includes('apache:http_server'))).toBe(true);
    });

    it('should map nginx banner to CPE', () => {
      const cpes = mapServiceToCpe('nginx/1.18.0');

      expect(cpes.some(c => c.includes('nginx'))).toBe(true);
    });

    it('should map MySQL banner to CPE', () => {
      const cpes = mapServiceToCpe('MySQL 8.0.28');

      expect(cpes.some(c => c.includes('mysql'))).toBe(true);
    });

    it('should map PostgreSQL banner to CPE', () => {
      const cpes = mapServiceToCpe('PostgreSQL 14.2');

      expect(cpes.some(c => c.includes('postgresql'))).toBe(true);
    });

    it('should map OpenSSH banner to CPE', () => {
      const cpes = mapServiceToCpe('OpenSSH_8.4p1');

      expect(cpes.some(c => c.includes('openssh'))).toBe(true);
    });

    it('should return empty array for unknown service', () => {
      const cpes = mapServiceToCpe('UnknownService/1.0');

      expect(cpes).toHaveLength(0);
    });

    it('should handle case-insensitive matching', () => {
      const cpes1 = mapServiceToCpe('APACHE/2.4');
      const cpes2 = mapServiceToCpe('apache/2.4');

      expect(cpes1.length).toBeGreaterThan(0);
      expect(cpes1).toEqual(cpes2);
    });

    it('should extract version from banner', () => {
      const cpes = mapServiceToCpe('nginx/1.20.1');

      // Should include version-specific CPE
      expect(cpes.some(c => c.includes(':1'))).toBe(true);
    });
  });

  describe('SERVICE_TO_CPE_MAPPINGS', () => {
    it('should have mappings for common web servers', () => {
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('apache');
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('nginx');
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('microsoft-iis');
    });

    it('should have mappings for common databases', () => {
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('mysql');
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('postgresql');
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('mongodb');
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('redis');
    });

    it('should have mappings for SSH services', () => {
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('openssh');
    });

    it('should have mappings for mail servers', () => {
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('postfix');
      expect(SERVICE_TO_CPE_MAPPINGS).toHaveProperty('exim');
    });
  });
});

describe('CVE Integration - NVD API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the rate limiter before each test
    resetNvdRateLimiter();
  });

  describe('searchNvdCves', () => {
    it('should search NVD API with keyword', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          resultsPerPage: 10,
          startIndex: 0,
          totalResults: 1,
          vulnerabilities: [{
            cve: {
              id: 'CVE-2024-12345',
              descriptions: [{ lang: 'en', value: 'Test vulnerability' }],
              published: '2024-01-15T00:00:00.000',
              lastModified: '2024-01-15T00:00:00.000',
              metrics: {
                cvssMetricV31: [{
                  cvssData: {
                    baseScore: 7.5,
                    vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N',
                    baseSeverity: 'HIGH',
                  },
                }],
              },
              references: [{ url: 'https://example.com/advisory' }],
            },
          }],
        }),
      });

      const result = await searchNvdCves({ keyword: 'apache' });

      expect(result.total_results).toBe(1);
      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0].cve_id).toBe('CVE-2024-12345');
      expect(result.vulnerabilities[0].cvss_v3_score).toBe(7.5);
      expect(result.vulnerabilities[0].cvss_v3_severity).toBe('HIGH');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(searchNvdCves({ keyword: 'test' }))
        .rejects
        .toThrow('NVD API error');
    });
  });

  describe('getCveById', () => {
    it('should get CVE by ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          resultsPerPage: 1,
          startIndex: 0,
          totalResults: 1,
          vulnerabilities: [{
            cve: {
              id: 'CVE-2024-12345',
              descriptions: [{ lang: 'en', value: 'Test' }],
              published: '2024-01-15T00:00:00.000',
              lastModified: '2024-01-15T00:00:00.000',
            },
          }],
        }),
      });

      const cve = await getCveById('CVE-2024-12345');

      expect(cve).not.toBeNull();
      expect(cve?.cve_id).toBe('CVE-2024-12345');
    });

    it('should return null for non-existent CVE', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          resultsPerPage: 0,
          startIndex: 0,
          totalResults: 0,
          vulnerabilities: [],
        }),
      });

      const cve = await getCveById('CVE-9999-99999');

      expect(cve).toBeNull();
    });
  });

  describe('getCvesForCpe', () => {
    it('should get CVEs for a CPE', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          resultsPerPage: 10,
          startIndex: 0,
          totalResults: 2,
          vulnerabilities: [
            {
              cve: {
                id: 'CVE-2024-1111',
                descriptions: [{ lang: 'en', value: 'First CVE' }],
                published: '2024-01-15T00:00:00.000',
                lastModified: '2024-01-15T00:00:00.000',
              },
            },
            {
              cve: {
                id: 'CVE-2024-2222',
                descriptions: [{ lang: 'en', value: 'Second CVE' }],
                published: '2024-01-15T00:00:00.000',
                lastModified: '2024-01-15T00:00:00.000',
              },
            },
          ],
        }),
      });

      const cves = await getCvesForCpe('cpe:2.3:a:apache:http_server:2.4:*:*:*:*:*:*:*');

      expect(cves).toHaveLength(2);
    });
  });
});

describe('CVE Integration - EPSS API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEpssScore', () => {
    it('should get EPSS score for a CVE', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'OK',
          data: [{
            cve: 'CVE-2024-12345',
            epss: '0.12345',
            percentile: '0.85',
            date: '2024-01-15',
          }],
        }),
      });

      const score = await getEpssScore('CVE-2024-12345');

      expect(score).not.toBeNull();
      expect(score?.cve_id).toBe('CVE-2024-12345');
      expect(score?.epss).toBeCloseTo(0.12345);
      expect(score?.percentile).toBeCloseTo(85); // Converted to percentage
    });

    it('should return null for CVE without EPSS score', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'OK',
          data: [],
        }),
      });

      const score = await getEpssScore('CVE-9999-99999');

      expect(score).toBeNull();
    });
  });

  describe('getEpssScores', () => {
    it('should get EPSS scores for multiple CVEs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'OK',
          data: [
            { cve: 'CVE-2024-1111', epss: '0.5', percentile: '0.9', date: '2024-01-15' },
            { cve: 'CVE-2024-2222', epss: '0.3', percentile: '0.7', date: '2024-01-15' },
          ],
        }),
      });

      const scores = await getEpssScores(['CVE-2024-1111', 'CVE-2024-2222']);

      expect(scores.size).toBe(2);
      expect(scores.get('CVE-2024-1111')?.epss).toBeCloseTo(0.5);
      expect(scores.get('CVE-2024-2222')?.epss).toBeCloseTo(0.3);
    });

    it('should return empty map for empty CVE list', async () => {
      const scores = await getEpssScores([]);

      expect(scores.size).toBe(0);
    });
  });

  describe('enrichCvesWithEpss', () => {
    it('should enrich CVE records with EPSS scores', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'OK',
          data: [
            { cve: 'CVE-2024-1111', epss: '0.5', percentile: '0.9', date: '2024-01-15' },
          ],
        }),
      });

      const cves = [{
        cve_id: 'CVE-2024-1111',
        description: 'Test CVE',
        published_date: '2024-01-15',
        last_modified_date: '2024-01-15',
        references: [],
        affected_products: [],
      }];

      const enriched = await enrichCvesWithEpss(cves);

      expect(enriched).toHaveLength(1);
      expect(enriched[0].epss).toBeDefined();
      expect(enriched[0].epss?.epss).toBeCloseTo(0.5);
    });
  });
});

describe('CVE Integration - Utilities', () => {
  describe('getCvssSeverity', () => {
    it('should return CRITICAL for score >= 9.0', () => {
      expect(getCvssSeverity(9.0)).toBe('CRITICAL');
      expect(getCvssSeverity(10.0)).toBe('CRITICAL');
    });

    it('should return HIGH for score >= 7.0 and < 9.0', () => {
      expect(getCvssSeverity(7.0)).toBe('HIGH');
      expect(getCvssSeverity(8.9)).toBe('HIGH');
    });

    it('should return MEDIUM for score >= 4.0 and < 7.0', () => {
      expect(getCvssSeverity(4.0)).toBe('MEDIUM');
      expect(getCvssSeverity(6.9)).toBe('MEDIUM');
    });

    it('should return LOW for score >= 0.1 and < 4.0', () => {
      expect(getCvssSeverity(0.1)).toBe('LOW');
      expect(getCvssSeverity(3.9)).toBe('LOW');
    });

    it('should return NONE for score 0', () => {
      expect(getCvssSeverity(0)).toBe('NONE');
    });

    it('should return UNKNOWN for undefined score', () => {
      expect(getCvssSeverity(undefined)).toBe('UNKNOWN');
    });
  });

  describe('isVersionAffected', () => {
    it('should return true when version is within affected range', () => {
      const match = {
        cpe23_uri: 'cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*',
        vulnerable: true,
        version_start_including: '1.0',
        version_end_including: '2.0',
      };

      expect(isVersionAffected('1.5', match)).toBe(true);
      expect(isVersionAffected('1.0', match)).toBe(true);
      expect(isVersionAffected('2.0', match)).toBe(true);
    });

    it('should return false when version is outside affected range', () => {
      const match = {
        cpe23_uri: 'cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*',
        vulnerable: true,
        version_start_including: '1.0',
        version_end_including: '2.0',
      };

      expect(isVersionAffected('0.9', match)).toBe(false);
      expect(isVersionAffected('2.1', match)).toBe(false);
    });

    it('should handle version_start_excluding', () => {
      const match = {
        cpe23_uri: 'cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*',
        vulnerable: true,
        version_start_excluding: '1.0',
        version_end_including: '2.0',
      };

      expect(isVersionAffected('1.0', match)).toBe(false);
      expect(isVersionAffected('1.1', match)).toBe(true);
    });

    it('should handle version_end_excluding', () => {
      const match = {
        cpe23_uri: 'cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*',
        vulnerable: true,
        version_start_including: '1.0',
        version_end_excluding: '2.0',
      };

      expect(isVersionAffected('2.0', match)).toBe(false);
      expect(isVersionAffected('1.9', match)).toBe(true);
    });

    it('should return false when not vulnerable', () => {
      const match = {
        cpe23_uri: 'cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*',
        vulnerable: false,
        version_start_including: '1.0',
        version_end_including: '2.0',
      };

      expect(isVersionAffected('1.5', match)).toBe(false);
    });

    it('should handle multi-part version numbers', () => {
      const match = {
        cpe23_uri: 'cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*',
        vulnerable: true,
        version_start_including: '1.2.3',
        version_end_including: '1.5.0',
      };

      expect(isVersionAffected('1.3.0', match)).toBe(true);
      expect(isVersionAffected('1.2.2', match)).toBe(false);
      expect(isVersionAffected('1.5.1', match)).toBe(false);
    });
  });
});
