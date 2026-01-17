import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dns from 'dns/promises';

// Mock dns module
vi.mock('dns/promises', () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  resolveMx: vi.fn(),
  resolveNs: vi.fn(),
  resolveTxt: vi.fn(),
  resolveSoa: vi.fn(),
  resolveCname: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  resolveARecords,
  resolveAAAARecords,
  resolveMxRecords,
  resolveNsRecords,
  resolveTxtRecords,
  resolveSoaRecord,
  resolveCnameRecords,
  getAllDnsRecords,
  checkSpfRecord,
  checkDmarcRecord,
  checkDkimSelector,
  getEmailSecurityReport,
  checkHttpSecurityHeaders,
  resolveHostToIps,
  checkSubdomainExists,
  generateBucketNames,
  checkS3BucketAccess,
} from './asmScanner';

describe('ASM Scanner DNS Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveARecords', () => {
    it('should resolve A records for a domain', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['192.168.1.1', '192.168.1.2']);

      const records = await resolveARecords('example.com');

      expect(records).toEqual([
        { address: '192.168.1.1' },
        { address: '192.168.1.2' },
      ]);
      expect(dns.resolve4).toHaveBeenCalledWith('example.com');
    });

    it('should return empty array when no A records found', async () => {
      const error = new Error('ENODATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      vi.mocked(dns.resolve4).mockRejectedValue(error);

      const records = await resolveARecords('example.com');

      expect(records).toEqual([]);
    });

    it('should return empty array when domain not found', async () => {
      const error = new Error('ENOTFOUND') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      vi.mocked(dns.resolve4).mockRejectedValue(error);

      const records = await resolveARecords('nonexistent.example.com');

      expect(records).toEqual([]);
    });
  });

  describe('resolveAAAARecords', () => {
    it('should resolve AAAA records for a domain', async () => {
      vi.mocked(dns.resolve6).mockResolvedValue(['2001:db8::1', '2001:db8::2']);

      const records = await resolveAAAARecords('example.com');

      expect(records).toEqual([
        { address: '2001:db8::1' },
        { address: '2001:db8::2' },
      ]);
    });

    it('should return empty array when no AAAA records found', async () => {
      const error = new Error('ENODATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      vi.mocked(dns.resolve6).mockRejectedValue(error);

      const records = await resolveAAAARecords('example.com');

      expect(records).toEqual([]);
    });
  });

  describe('resolveMxRecords', () => {
    it('should resolve MX records sorted by priority', async () => {
      vi.mocked(dns.resolveMx).mockResolvedValue([
        { exchange: 'mail2.example.com', priority: 20 },
        { exchange: 'mail1.example.com', priority: 10 },
      ]);

      const records = await resolveMxRecords('example.com');

      expect(records).toEqual([
        { exchange: 'mail1.example.com', priority: 10 },
        { exchange: 'mail2.example.com', priority: 20 },
      ]);
    });

    it('should return empty array when no MX records found', async () => {
      const error = new Error('ENODATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      vi.mocked(dns.resolveMx).mockRejectedValue(error);

      const records = await resolveMxRecords('example.com');

      expect(records).toEqual([]);
    });
  });

  describe('resolveNsRecords', () => {
    it('should resolve NS records for a domain', async () => {
      vi.mocked(dns.resolveNs).mockResolvedValue(['ns1.example.com', 'ns2.example.com']);

      const records = await resolveNsRecords('example.com');

      expect(records).toEqual([
        { value: 'ns1.example.com' },
        { value: 'ns2.example.com' },
      ]);
    });
  });

  describe('resolveTxtRecords', () => {
    it('should resolve TXT records for a domain', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['v=spf1 include:_spf.google.com ~all'],
        ['google-site-verification=abc123'],
      ]);

      const records = await resolveTxtRecords('example.com');

      expect(records).toEqual([
        { value: ['v=spf1 include:_spf.google.com ~all'] },
        { value: ['google-site-verification=abc123'] },
      ]);
    });
  });

  describe('resolveSoaRecord', () => {
    it('should resolve SOA record for a domain', async () => {
      vi.mocked(dns.resolveSoa).mockResolvedValue({
        nsname: 'ns1.example.com',
        hostmaster: 'admin.example.com',
        serial: 2024010101,
        refresh: 3600,
        retry: 600,
        expire: 604800,
        minttl: 86400,
      });

      const record = await resolveSoaRecord('example.com');

      expect(record).toEqual({
        nsname: 'ns1.example.com',
        hostmaster: 'admin.example.com',
        serial: 2024010101,
        refresh: 3600,
        retry: 600,
        expire: 604800,
        minttl: 86400,
      });
    });

    it('should return null when no SOA record found', async () => {
      const error = new Error('ENODATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      vi.mocked(dns.resolveSoa).mockRejectedValue(error);

      const record = await resolveSoaRecord('example.com');

      expect(record).toBeNull();
    });
  });

  describe('resolveCnameRecords', () => {
    it('should resolve CNAME records for a domain', async () => {
      vi.mocked(dns.resolveCname).mockResolvedValue(['www.example.com']);

      const records = await resolveCnameRecords('example.com');

      expect(records).toEqual([{ value: 'www.example.com' }]);
    });
  });

  describe('getAllDnsRecords', () => {
    it('should get all DNS records for a domain', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['192.168.1.1']);
      vi.mocked(dns.resolve6).mockResolvedValue(['2001:db8::1']);
      vi.mocked(dns.resolveMx).mockResolvedValue([{ exchange: 'mail.example.com', priority: 10 }]);
      vi.mocked(dns.resolveNs).mockResolvedValue(['ns1.example.com']);
      vi.mocked(dns.resolveTxt).mockResolvedValue([['v=spf1 ~all']]);
      vi.mocked(dns.resolveSoa).mockResolvedValue({
        nsname: 'ns1.example.com',
        hostmaster: 'admin.example.com',
        serial: 1,
        refresh: 3600,
        retry: 600,
        expire: 604800,
        minttl: 86400,
      });
      vi.mocked(dns.resolveCname).mockResolvedValue([]);

      const records = await getAllDnsRecords('example.com');

      expect(records.a).toHaveLength(1);
      expect(records.aaaa).toHaveLength(1);
      expect(records.mx).toHaveLength(1);
      expect(records.ns).toHaveLength(1);
      expect(records.txt).toHaveLength(1);
      expect(records.soa).not.toBeNull();
      expect(records.cname).toHaveLength(0);
    });
  });
});

describe('ASM Scanner Email Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkSpfRecord', () => {
    it('should detect SPF record with -all policy', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['v=spf1 include:_spf.google.com ip4:192.168.1.0/24 -all'],
      ]);

      const spf = await checkSpfRecord('example.com');

      expect(spf.present).toBe(true);
      expect(spf.policy).toBe('fail');
      expect(spf.includes).toContain('_spf.google.com');
      expect(spf.ip4).toContain('192.168.1.0/24');
      expect(spf.all).toBe('-all');
    });

    it('should detect SPF record with ~all policy', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['v=spf1 include:_spf.google.com ~all'],
      ]);

      const spf = await checkSpfRecord('example.com');

      expect(spf.present).toBe(true);
      expect(spf.policy).toBe('softfail');
    });

    it('should detect SPF record with +all policy', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['v=spf1 +all'],
      ]);

      const spf = await checkSpfRecord('example.com');

      expect(spf.present).toBe(true);
      expect(spf.policy).toBe('pass');
    });

    it('should return not present when no SPF record', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['google-site-verification=abc123'],
      ]);

      const spf = await checkSpfRecord('example.com');

      expect(spf.present).toBe(false);
    });
  });

  describe('checkDmarcRecord', () => {
    it('should detect DMARC record with reject policy', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['v=DMARC1; p=reject; rua=mailto:dmarc@example.com; pct=100'],
      ]);

      const dmarc = await checkDmarcRecord('example.com');

      expect(dmarc.present).toBe(true);
      expect(dmarc.policy).toBe('reject');
      expect(dmarc.pct).toBe(100);
      expect(dmarc.rua).toContain('mailto:dmarc@example.com');
    });

    it('should detect DMARC record with quarantine policy', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['v=DMARC1; p=quarantine; sp=reject'],
      ]);

      const dmarc = await checkDmarcRecord('example.com');

      expect(dmarc.present).toBe(true);
      expect(dmarc.policy).toBe('quarantine');
      expect(dmarc.subdomain_policy).toBe('reject');
    });

    it('should return not present when no DMARC record', async () => {
      const error = new Error('ENODATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      vi.mocked(dns.resolveTxt).mockRejectedValue(error);

      const dmarc = await checkDmarcRecord('example.com');

      expect(dmarc.present).toBe(false);
    });
  });

  describe('checkDkimSelector', () => {
    it('should detect DKIM record for a selector', async () => {
      vi.mocked(dns.resolveTxt).mockResolvedValue([
        ['v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ...'],
      ]);

      const dkim = await checkDkimSelector('example.com', 'google');

      expect(dkim.present).toBe(true);
      expect(dkim.selector).toBe('google');
      expect(dkim.key_type).toBe('rsa');
    });

    it('should return not present when selector not found', async () => {
      const error = new Error('ENODATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      vi.mocked(dns.resolveTxt).mockRejectedValue(error);

      const dkim = await checkDkimSelector('example.com', 'nonexistent');

      expect(dkim.present).toBe(false);
      expect(dkim.selector).toBe('nonexistent');
    });
  });

  describe('getEmailSecurityReport', () => {
    it('should get complete email security report', async () => {
      // Mock SPF
      vi.mocked(dns.resolveTxt)
        .mockResolvedValueOnce([['v=spf1 -all']]) // SPF
        .mockResolvedValueOnce([['v=DMARC1; p=reject']]) // DMARC
        .mockRejectedValue((() => { // DKIM selectors
          const error = new Error('ENODATA') as NodeJS.ErrnoException;
          error.code = 'ENODATA';
          return error;
        })());

      const report = await getEmailSecurityReport('example.com');

      expect(report.spf.present).toBe(true);
      expect(report.dmarc.present).toBe(true);
      expect(report.dkim).toHaveLength(0);
    });
  });
});

describe('ASM Scanner HTTP Security Headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkHttpSecurityHeaders', () => {
    it('should detect security headers', async () => {
      const mockHeaders = new Headers({
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'server': 'nginx/1.18.0',
      });

      mockFetch.mockResolvedValue({
        status: 200,
        headers: mockHeaders,
      });

      const report = await checkHttpSecurityHeaders('https://example.com');

      expect(report.status_code).toBe(200);
      expect(report.security_headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(report.security_headers['x-frame-options']).toBe('DENY');
      expect(report.missing_security_headers).toHaveLength(0);
      expect(report.server_info).toBe('nginx/1.18.0');
    });

    it('should identify missing security headers', async () => {
      const mockHeaders = new Headers({
        'server': 'Apache',
      });

      mockFetch.mockResolvedValue({
        status: 200,
        headers: mockHeaders,
      });

      const report = await checkHttpSecurityHeaders('https://example.com');

      expect(report.missing_security_headers).toContain('strict-transport-security');
      expect(report.missing_security_headers).toContain('content-security-policy');
      expect(report.missing_security_headers).toContain('x-frame-options');
      expect(report.missing_security_headers).toContain('x-content-type-options');
    });

    it('should extract technology hints', async () => {
      const mockHeaders = new Headers({
        'server': 'nginx',
        'x-powered-by': 'Express',
      });

      mockFetch.mockResolvedValue({
        status: 200,
        headers: mockHeaders,
      });

      const report = await checkHttpSecurityHeaders('https://example.com');

      expect(report.technology_hints).toContain('nginx');
      expect(report.technology_hints).toContain('Express');
    });
  });
});

describe('ASM Scanner Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveHostToIps', () => {
    it('should resolve both IPv4 and IPv6 addresses', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['192.168.1.1']);
      vi.mocked(dns.resolve6).mockResolvedValue(['2001:db8::1']);

      const ips = await resolveHostToIps('example.com');

      expect(ips).toContain('192.168.1.1');
      expect(ips).toContain('2001:db8::1');
    });

    it('should handle domains with only IPv4', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['192.168.1.1']);
      const error = new Error('ENODATA') as NodeJS.ErrnoException;
      error.code = 'ENODATA';
      vi.mocked(dns.resolve6).mockRejectedValue(error);

      const ips = await resolveHostToIps('example.com');

      expect(ips).toEqual(['192.168.1.1']);
    });
  });

  describe('checkSubdomainExists', () => {
    it('should return true when subdomain resolves', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['192.168.1.1']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const exists = await checkSubdomainExists('www.example.com');

      expect(exists).toBe(true);
    });

    it('should return false when subdomain does not resolve', async () => {
      const error = new Error('ENOTFOUND') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      vi.mocked(dns.resolve4).mockRejectedValue(error);
      vi.mocked(dns.resolve6).mockRejectedValue(error);

      const exists = await checkSubdomainExists('nonexistent.example.com');

      expect(exists).toBe(false);
    });
  });

  describe('generateBucketNames', () => {
    it('should generate bucket name variants for a domain', async () => {
      const buckets = generateBucketNames('example.com');

      expect(buckets).toContain('example-com');
      expect(buckets).toContain('example');
      expect(buckets).toContain('example-backup');
      expect(buckets).toContain('example-assets');
      expect(buckets).toContain('example-static');
    });
  });

  describe('checkS3BucketAccess', () => {
    it('should detect accessible S3 bucket', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('<ListBucketResult><Contents></Contents></ListBucketResult>'),
      });

      const result = await checkS3BucketAccess('public-bucket');

      expect(result.accessible).toBe(true);
      expect(result.listable).toBe(true);
      expect(result.url).toBe('https://public-bucket.s3.amazonaws.com');
    });

    it('should detect non-existent S3 bucket', async () => {
      mockFetch.mockResolvedValue({
        status: 404,
        text: () => Promise.resolve('NoSuchBucket'),
      });

      const result = await checkS3BucketAccess('nonexistent-bucket');

      expect(result.accessible).toBe(false);
      expect(result.listable).toBe(false);
    });

    it('should detect accessible but not listable S3 bucket', async () => {
      mockFetch.mockResolvedValue({
        status: 403,
        text: () => Promise.resolve('AccessDenied'),
      });

      const result = await checkS3BucketAccess('private-bucket');

      expect(result.accessible).toBe(true);
      expect(result.listable).toBe(false);
    });
  });
});
