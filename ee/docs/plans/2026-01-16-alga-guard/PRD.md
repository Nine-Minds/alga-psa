# PRD — Alga Guard

- Slug: `alga-guard`
- Date: `2026-01-16`
- Status: Draft

## Summary

Alga Guard is a security and compliance module integrated into Alga PSA that provides three core capabilities:

1. **PII Scanner** — Scans managed endpoints for personally identifiable information (SSN, credit cards, etc.) to help MSPs ensure their clients comply with data protection regulations (GDPR, CCPA, HIPAA, PCI-DSS).

2. **Attack Surface Mapper (ASM)** — Performs external reconnaissance on client domains to discover exposed assets, vulnerabilities, and potential security risks from an attacker's perspective.

3. **Security Score** — A unified 0-100 security rating per client (think "FICO Score for Security") that aggregates findings from PII and ASM scans into a single, sellable metric. MSPs use this score to demonstrate risk, justify security investments, and track improvement over time.

## Problem

MSPs managing client infrastructure face increasing pressure to:

- **Demonstrate compliance** with data protection regulations that require knowing where PII is stored
- **Reduce attack surface** by understanding what's externally exposed before attackers do
- **Provide security assessments** as a value-add service to differentiate from competitors

Currently, MSPs must cobble together multiple point solutions or manually audit systems, which is time-consuming, error-prone, and doesn't scale.

## Goals

1. Enable MSPs to discover PII on managed endpoints without exposing the actual sensitive data
2. Provide external attack surface visibility for client domains
3. Integrate seamlessly with existing Alga PSA tenant/company/asset hierarchy
4. Generate compliance-ready reports for client delivery
5. Support scheduled and on-demand scanning for both modules
6. **Provide a single "Security Score" per client** that MSPs can use to sell security services and demonstrate improvement over time

## Non-goals

- **Data Loss Prevention (DLP)** — We discover PII location but don't block/prevent data exfiltration
- **Vulnerability remediation** — ASM identifies vulnerabilities but doesn't patch them
- **Penetration testing** — ASM is reconnaissance only, not active exploitation
- **Real-time PII monitoring** — Scans are point-in-time, not continuous file system watchers
- **Monitoring/observability infrastructure** — Out of scope unless explicitly needed for core functionality
- **Custom regex builder UI** — Users select from predefined PII types; custom patterns are a future enhancement

---

## Module Integration with Alga PSA

### Feature Flag Configuration

Alga Guard uses the existing PostHog-based feature flag system. Add to `DEFAULT_BOOLEAN_FLAGS` in `/server/src/lib/feature-flags/featureFlags.ts`:

```typescript
const DEFAULT_BOOLEAN_FLAGS: Record<string, boolean> = {
  // ... existing flags
  'enable_alga_guard': false,
  'enable_alga_guard_pii': false,      // Sub-module toggle for PII Scanner
  'enable_alga_guard_asm': false,      // Sub-module toggle for ASM
  'enable_alga_guard_score': false,    // Sub-module toggle for Security Score
};
```

**Usage in Components**:
```tsx
// Wrap navigation item
<FeatureFlagWrapper flag="enable_alga_guard">
  <SidebarSection title="Alga Guard" icon={ShieldIcon}>
    <FeatureFlagWrapper flag="enable_alga_guard_pii">
      <SidebarLink href="/guard/pii" label="PII Scanner" />
    </FeatureFlagWrapper>
    {/* ... */}
  </SidebarSection>
</FeatureFlagWrapper>

// Hook usage in pages
const isGuardEnabled = useFeatureFlag('enable_alga_guard');
```

### RBAC Permissions

Define in `/server/src/lib/auth/permissions/guard.ts`:

```typescript
export const GUARD_PERMISSIONS = {
  // PII Scanner
  'guard:pii:view': 'View PII scan results and dashboards',
  'guard:pii:manage_profiles': 'Create, edit, delete scan profiles',
  'guard:pii:execute_scan': 'Trigger on-demand scans',
  'guard:pii:purge_results': 'Delete individual scan results',
  'guard:pii:purge_all': 'Delete all scan results (admin)',
  'guard:pii:generate_reports': 'Generate PII reports',

  // ASM
  'guard:asm:view': 'View ASM results and dashboards',
  'guard:asm:manage_domains': 'Add, edit, remove domains',
  'guard:asm:execute_scan': 'Trigger on-demand ASM scans',
  'guard:asm:generate_reports': 'Generate ASM reports',
  'guard:asm:configure_scanners': 'Configure scanner pods (admin)',

  // Security Score
  'guard:score:view': 'View security scores',
  'guard:score:generate_reports': 'Generate score reports',
  'guard:score:configure_weights': 'Configure score weights (admin)',

  // Scheduling
  'guard:schedules:manage': 'Create, edit, delete scan schedules',
} as const;

// Default role assignments
export const GUARD_ROLE_MAPPINGS = {
  'tenant_admin': Object.keys(GUARD_PERMISSIONS),
  'msp_admin': Object.keys(GUARD_PERMISSIONS),
  'msp_tech': [
    'guard:pii:view', 'guard:pii:manage_profiles', 'guard:pii:execute_scan',
    'guard:pii:purge_results', 'guard:pii:generate_reports',
    'guard:asm:view', 'guard:asm:manage_domains', 'guard:asm:execute_scan',
    'guard:asm:generate_reports',
    'guard:score:view', 'guard:score:generate_reports',
    'guard:schedules:manage',
  ],
  'msp_viewer': [
    'guard:pii:view', 'guard:asm:view', 'guard:score:view',
  ],
};
```

### Multi-Tenancy Integration

Alga Guard piggybacks on Alga PSA's existing multi-tenancy model:

**Tenant Context**:
- All Alga Guard tables include `tenant` column (UUID, NOT NULL)
- Primary keys include tenant: `PRIMARY KEY (id, tenant)`
- Use `getCurrentTenantId()` from `/server/src/lib/db/index.tsx` for tenant resolution
- All queries must include `.where('tenant', tenant)` filter

**Tenant Resolution Priority**:
1. Async context via `tenantContext.getStore()`
2. Session (JWT token) via `(session?.user as any)?.tenant`
3. Request headers (`x-tenant-id`)
4. Dev fallback (`process.env.TENANT`)

**Example Query Pattern**:
```typescript
import { createTenantKnex } from '@/lib/db';

async function getPiiProfiles(): Promise<PiiProfile[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant context required');

  return knex('guard_pii_profiles')
    .where('tenant', tenant)
    .orderBy('created_at', 'desc');
}
```

### Shared Alga PSA Tables

Alga Guard references these existing tables:

| Table | Purpose | Join Pattern |
|-------|---------|--------------|
| `tenants` | Tenant master | `tenant` column |
| `companies` | Client companies | `company_id, tenant` |
| `assets` | Managed endpoints | `asset_id, tenant` |
| `users` | User accounts | `user_id, tenant` |
| `agents` | RMM agents | `agent_id, tenant` |

---

## Users and Primary Flows

### Personas

| Persona | Description | Primary Use |
|---------|-------------|-------------|
| **MSP Technician** | Day-to-day user running scans, reviewing results | Execute scans, triage findings |
| **MSP Manager/vCISO** | Security-focused, needs reporting for clients | Generate reports, review dashboards |
| **Tenant Admin** | Alga PSA tenant administrator | Configure module settings, manage access |

### Primary Flows

#### Flow 1: PII Scan Profile Creation & Execution
1. User navigates to Alga Guard → PII Scanner → Profiles
2. Creates new profile: name, selects PII types, file extensions, target agents/companies
3. Configures include/exclude paths
4. Saves profile and optionally triggers immediate scan
5. Views job progress in Jobs list
6. Reviews results showing file locations (not actual PII)

#### Flow 2: PII Results Review & Reporting
1. User views PII Dashboard for aggregate metrics
2. Drills into specific findings by company/asset/PII type
3. Views detail panel showing file path, line numbers, date found
4. Generates Word/Excel report for client delivery
5. Optionally purges old results

#### Flow 3: Attack Surface Domain Setup
1. User navigates to Alga Guard → Attack Surface Mapper → Domains
2. Adds client domain (e.g., acmecorp.com)
3. Chooses immediate scan or schedules for later
4. Views scan progress

#### Flow 4: ASM Results Analysis
1. User views domain dashboard showing summary counts
2. Explores discovered assets: IPs, subdomains, open ports, cloud storage
3. Reviews vulnerabilities with CVE details and scores
4. Examines DNS records, headers, MX records
5. Generates report for client

#### Flow 5: Scheduled Scanning
1. User creates schedule for PII or ASM scans (daily/weekly/monthly)
2. System executes scans automatically
3. User receives notification on completion
4. Results available in respective dashboards

#### Flow 6: Security Score Sales Conversation
1. MSP opens client's Security Score dashboard
2. Views current score (0-100) with color-coded risk level
3. Reviews score breakdown showing contributing factors (PII exposure, open ports, CVEs, etc.)
4. Shows client historical trend ("You were at 35 last quarter, now you're at 52")
5. Identifies top issues dragging down the score
6. Proposes remediation: "If we address these 3 critical items, your score will improve to ~75"
7. Generates Security Score Report for client presentation
8. After remediation, re-scans to demonstrate score improvement

---

## Technical Specifications

### Technology Stack

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| **Backend** | Node.js/TypeScript | 20.x | Server-side logic |
| **Database** | PostgreSQL + CitusDB | 15+ | Data storage (multi-tenant distributed) |
| **Job Queue** | PG Boss | 10.1.6 | Background job processing |
| **Event Bus** | Redis Streams | 7+ | Async notifications |
| **PDF Generation** | Puppeteer | 22+ | Report PDFs |
| **Excel Generation** | xlsx | 0.18.5 | Excel reports |
| **Word Generation** | docx | 8+ | Word reports |
| **Agent Scanner** | Rust/WebAssembly | - | On-agent PII detection |
| **ASM Scanner** | Node.js/TypeScript | 20.x | External reconnaissance (containerized) |

### Library Dependencies

#### Server-Side (Node.js)

```json
{
  "dependencies": {
    "pg-boss": "^10.1.6",
    "xlsx": "^0.18.5",
    "docx": "^8.5.0",
    "puppeteer": "^22.0.0",
    "node-cron": "^3.0.3",
    "axios": "^1.6.0",
    "maxmind": "^4.3.0"
  }
}
```

#### Agent-Side (Rust/WASM)

```toml
[dependencies]
regex = "1.10"
walkdir = "2.4"
zip = "0.6"
pdf-extract = "0.7"
calamine = "0.24"        # Excel reading
docx-rs = "0.4"          # Word reading
encoding_rs = "0.8"      # Character encoding detection
```

#### ASM Scanner (Node.js)

```json
{
  "dependencies": {
    "dns2": "^2.1.0",
    "evilscan": "^2.1.3",
    "axios": "^1.6.0",
    "@aws-sdk/client-s3": "^3.500.0",
    "@azure/storage-blob": "^12.17.0",
    "@google-cloud/storage": "^7.7.0",
    "maxmind": "^4.3.0",
    "tls": "^0.0.1"
  }
}
```

**Note**: The ASM scanner runs as a containerized Node.js service in Kubernetes. The container includes `nmap` binary for port scanning via shell execution.

---

## PII Detection Engine

### Detection Algorithm

The PII scanner operates in two phases:

**Phase 1: Regex-Based Detection** (runs on-agent)
- Fast, deterministic pattern matching
- Handles structured PII (SSN, CC, phone, etc.)
- Returns file path, line number, pattern type, confidence

**Phase 2: ML-Based NER** (optional, server-side)
- For context-dependent PII (names, addresses)
- Only runs on files flagged by Phase 1
- Uses pre-trained spaCy model (`en_core_web_sm`)

### PII Types and Detection Patterns

#### High Severity (Weight: 10 points per instance)

| PII Type | Pattern | Validation | Example |
|----------|---------|------------|---------|
| **SSN** | `\b(?!000|666|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b` | Area ≠ 000,666,900-999; Group ≠ 00; Serial ≠ 0000 | 123-45-6789 |
| **Credit Card (Visa)** | `\b4[0-9]{12}(?:[0-9]{3})?\b` | Luhn checksum | 4111111111111111 |
| **Credit Card (MC)** | `\b(?:5[1-5][0-9]{2}|222[1-9]|22[3-9][0-9]|2[3-6][0-9]{2}|27[01][0-9]|2720)[0-9]{12}\b` | Luhn checksum | 5500000000000004 |
| **Credit Card (Amex)** | `\b3[47][0-9]{13}\b` | Luhn checksum | 378282246310005 |
| **Credit Card (Discover)** | `\b6(?:011|5[0-9]{2})[0-9]{12}\b` | Luhn checksum | 6011111111111117 |
| **Bank Account** | `\b[0-9]{8,17}\b` (context: near "account", "routing", "aba") | Routing number ABA validation | 021000021 |

**Luhn Algorithm Implementation**:
```typescript
function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}
```

#### Medium Severity (Weight: 5 points per instance)

| PII Type | Pattern | Validation | Example |
|----------|---------|------------|---------|
| **DOB** | `\b(?:0[1-9]|1[0-2])[/\-.](?:0[1-9]|[12]\d|3[01])[/\-.](?:19|20)\d{2}\b` | Valid date | 01/15/1990 |
| **DOB (ISO)** | `\b(?:19|20)\d{2}[/\-.](?:0[1-9]|1[0-2])[/\-.](?:0[1-9]|[12]\d|3[01])\b` | Valid date | 1990-01-15 |
| **Driver's License (CA)** | `\b[A-Z]\d{7}\b` | Context: "license", "DL", "CA" | A1234567 |
| **Driver's License (NY)** | `\b\d{3}[ -]?\d{3}[ -]?\d{3}\b` | Context: "license", "DL", "NY" | 123-456-789 |
| **Driver's License (TX)** | `\b\d{8}\b` | Context: "license", "DL", "TX" | 12345678 |
| **Passport** | `\b[A-Z]{1,2}\d{6,9}\b` | Context: "passport" | AB1234567 |

**State-Specific Driver's License Patterns**:
```typescript
const DL_PATTERNS: Record<string, RegExp> = {
  'AL': /\b\d{7}\b/,
  'AK': /\b\d{7}\b/,
  'AZ': /\b[A-Z]\d{8}\b/,
  'CA': /\b[A-Z]\d{7}\b/,
  'CO': /\b\d{9}\b|[A-Z]{2}\d{3,6}\b/,
  'FL': /\b[A-Z]\d{12}\b/,
  'NY': /\b\d{9}\b/,
  'TX': /\b\d{8}\b/,
  // ... additional states
};
```

#### Low Severity (Weight: 2 points per instance)

| PII Type | Pattern | Validation | Example |
|----------|---------|------------|---------|
| **Email** | `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b` | TLD validation | user@example.com |
| **Phone (US)** | `\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b` | Valid area code | (555) 123-4567 |
| **Phone (Intl)** | `\b\+[1-9]\d{6,14}\b` | E.164 format | +442071234567 |
| **IP Address (v4)** | `\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b` | Valid octets | 192.168.1.1 |
| **IP Address (v6)** | `\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b` | - | 2001:db8::1 |
| **MAC Address** | `\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b` | - | 00:1A:2B:3C:4D:5E |

### File Processing Libraries

| File Type | Library | Extraction Method |
|-----------|---------|-------------------|
| **TXT, CSV, JSON, YAML, XML** | Native | Line-by-line reading |
| **PDF** | `pdf-extract` (Rust) / `pdfplumber` (Python) | Text extraction with page tracking |
| **DOC** | `antiword` (system) | Binary to text conversion |
| **DOCX** | `docx-rs` (Rust) / `python-docx` | XML parsing |
| **XLS** | `calamine` (Rust) / `xlrd` (Python) | Binary parsing |
| **XLSX** | `calamine` (Rust) / `openpyxl` (Python) | XML parsing |
| **ZIP** | `zip` (Rust) / `zipfile` (Python) | Recursive extraction |

### File Size Limits

| Limit | Default | Configurable |
|-------|---------|--------------|
| Max file size | 50 MB | Yes |
| Max files per scan | 100,000 | Yes |
| Max ZIP nesting depth | 3 levels | No |
| Max extracted ZIP size | 500 MB | Yes |

---

## Attack Surface Mapper (ASM)

### Reconnaissance Techniques

#### Subdomain Discovery

**Method 1: DNS Brute Force**

**Wordlist Source**: `SecLists/Discovery/DNS/subdomains-top1million-5000.txt`
- URL: https://github.com/danielmiessler/SecLists/blob/master/Discovery/DNS/subdomains-top1million-5000.txt
- Contains 4999 most common subdomain prefixes
- Download during build and embed in ASM scanner container

```typescript
// Top 100 most common subdomains (abbreviated for documentation)
const SUBDOMAIN_WORDLIST_TOP100 = [
  'www', 'mail', 'ftp', 'localhost', 'webmail', 'smtp', 'pop', 'ns1', 'ns2',
  'webdisk', 'cpanel', 'whm', 'autodiscover', 'autoconfig', 'ns', 'm',
  'imap', 'test', 'mx', 'admin', 'blog', 'pop3', 'dev', 'www2', 'ns3',
  'mail2', 'forum', 'vpn', 'ns4', 'webmail2', 'mail3', 'mobile', 'old',
  'exchange', 'remote', 'server', 'email', 'owa', 'support', 'api',
  'portal', 'secure', 'gateway', 'intranet', 'staging', 'beta', 'shop',
  'store', 'app', 'apps', 'demo', 'ftp2', 'mailhost', 'backup', 'host',
  'cloud', 'cdn', 'www1', 'static', 'media', 'images', 'img', 'video',
  'files', 'download', 'downloads', 'upload', 'uploads', 'proxy', 'ssh',
  'git', 'svn', 'mysql', 'sql', 'db', 'database', 'www3', 'extranet',
  'jenkins', 'ci', 'build', 'monitor', 'monitoring', 'nagios', 'prometheus',
  'grafana', 'kibana', 'elastic', 'rabbitmq', 'redis', 'mq', 'auth', 'sso',
  'oauth', 'login', 'connect', 'service', 'services', 'api2', 'ws', 'rest',
] as const;

// Full wordlist loaded from file at runtime (5000 entries)
import { readFileSync } from 'fs';

function loadSubdomainWordlist(): string[] {
  const content = readFileSync('/opt/seclists/subdomains-top1million-5000.txt', 'utf-8');
  return content.split('\n').map(line => line.trim()).filter(Boolean);
}

// DNS brute force using dns2 library
import { DNS } from 'dns2';

async function bruteForceSubdomains(domain: string, wordlist: string[]): Promise<string[]> {
  const dns = new DNS();
  const discovered: string[] = [];

  for (const prefix of wordlist) {
    const subdomain = `${prefix}.${domain}`;
    try {
      const result = await dns.resolveA(subdomain);
      if (result.answers.length > 0) {
        discovered.push(subdomain);
      }
    } catch {
      // NXDOMAIN or timeout - subdomain doesn't exist
    }
  }

  return discovered;
}
```

**Method 2: Certificate Transparency Logs**
```typescript
import axios from 'axios';

interface CrtShEntry {
  name_value: string;
  common_name: string;
}

async function discoverViaCertTransparency(domain: string): Promise<string[]> {
  const url = `https://crt.sh/?q=%.${domain}&output=json`;
  const response = await axios.get<CrtShEntry[]>(url, { timeout: 30000 });

  const subdomains = new Set<string>();
  for (const entry of response.data) {
    // name_value can contain multiple domains separated by newlines
    const names = entry.name_value.split('\n');
    for (const name of names) {
      if (name.endsWith(domain) && !name.startsWith('*')) {
        subdomains.add(name.toLowerCase());
      }
    }
  }

  return Array.from(subdomains);
}
```

**Method 3: DNS Zone Transfer (AXFR)**
```typescript
import { Resolver } from 'dns';
import { promisify } from 'util';

const resolver = new Resolver();
const resolveNs = promisify(resolver.resolveNs.bind(resolver));

async function attemptZoneTransfer(domain: string): Promise<string[]> {
  try {
    const nsRecords = await resolveNs(domain);

    for (const ns of nsRecords) {
      try {
        // Zone transfers require raw TCP socket - use dig as fallback
        const { execSync } = await import('child_process');
        const output = execSync(`dig @${ns} ${domain} AXFR +short`, {
          timeout: 10000,
          encoding: 'utf-8',
        });

        if (output && !output.includes('Transfer failed')) {
          return output.split('\n').filter(line => line.includes(domain));
        }
      } catch {
        continue;
      }
    }
  } catch {
    // NS lookup failed
  }

  return [];
}
```

#### Port Scanning

**Common Ports (Default Scan)**:
```typescript
type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

interface PortDefinition {
  service: string;
  risk: RiskLevel;
}

const COMMON_PORTS: Record<number, PortDefinition> = {
  // Critical Risk (Red) - Should never be exposed
  21:    { service: 'FTP', risk: 'critical' },
  23:    { service: 'Telnet', risk: 'critical' },
  3389:  { service: 'RDP', risk: 'critical' },
  5900:  { service: 'VNC', risk: 'critical' },

  // High Risk (Orange) - Sensitive services
  22:    { service: 'SSH', risk: 'high' },
  445:   { service: 'SMB', risk: 'high' },
  1433:  { service: 'MSSQL', risk: 'high' },
  3306:  { service: 'MySQL', risk: 'high' },
  5432:  { service: 'PostgreSQL', risk: 'high' },
  6379:  { service: 'Redis', risk: 'high' },
  27017: { service: 'MongoDB', risk: 'high' },

  // Medium Risk (Yellow) - Common services
  25:    { service: 'SMTP', risk: 'medium' },
  53:    { service: 'DNS', risk: 'medium' },
  110:   { service: 'POP3', risk: 'medium' },
  143:   { service: 'IMAP', risk: 'medium' },

  // Low Risk (Green) - Expected web services
  80:    { service: 'HTTP', risk: 'low' },
  443:   { service: 'HTTPS', risk: 'low' },
  8080:  { service: 'HTTP-Alt', risk: 'low' },
  8443:  { service: 'HTTPS-Alt', risk: 'low' },
};
```

**Service Banner Grabbing**:
```typescript
import { execSync } from 'child_process';

interface PortScanResult {
  port: number;
  state: 'open' | 'closed' | 'filtered';
  service: string;
  version: string;
  product: string;
}

function scanPorts(ip: string, ports: number[]): PortScanResult[] {
  const portList = ports.join(',');

  // Use nmap binary (must be installed in container)
  const output = execSync(
    `nmap -sV -T4 -p ${portList} --open -oX - ${ip}`,
    { timeout: 300000, encoding: 'utf-8' }
  );

  // Parse nmap XML output
  return parseNmapXml(output);
}

function parseNmapXml(xml: string): PortScanResult[] {
  const results: PortScanResult[] = [];

  // Simple regex parsing (in production, use xml2js or fast-xml-parser)
  const portMatches = xml.matchAll(
    /<port protocol="tcp" portid="(\d+)">.*?<state state="(\w+)".*?\/>.*?<service name="([^"]*)".*?product="([^"]*)".*?version="([^"]*)"/gs
  );

  for (const match of portMatches) {
    results.push({
      port: parseInt(match[1]),
      state: match[2] as 'open' | 'closed' | 'filtered',
      service: match[3] || 'unknown',
      product: match[4] || '',
      version: match[5] || '',
    });
  }

  return results;
}
```

#### Cloud Storage Detection

**AWS S3 Buckets**:
```typescript
import axios from 'axios';

const S3_BUCKET_PATTERNS = [
  '{company}.s3.amazonaws.com',
  '{company}-backup.s3.amazonaws.com',
  '{company}-dev.s3.amazonaws.com',
  '{company}-prod.s3.amazonaws.com',
  '{company}-data.s3.amazonaws.com',
  '{company}-assets.s3.amazonaws.com',
  '{company}-static.s3.amazonaws.com',
  '{company}-media.s3.amazonaws.com',
] as const;

interface BucketCheckResult {
  bucket: string;
  exists: boolean;
  public: boolean;
  authenticated: boolean;
}

async function checkS3Bucket(bucketName: string): Promise<BucketCheckResult> {
  const url = `https://${bucketName}.s3.amazonaws.com`;

  try {
    const response = await axios.head(url, {
      timeout: 5000,
      validateStatus: () => true, // Don't throw on 4xx/5xx
    });

    return {
      bucket: bucketName,
      exists: response.status !== 404,
      public: response.status === 200,
      authenticated: response.status === 403,
    };
  } catch {
    return { bucket: bucketName, exists: false, public: false, authenticated: false };
  }
}
```

**Azure Blob Storage**:
```typescript
const AZURE_BLOB_PATTERNS = [
  '{company}.blob.core.windows.net',
  '{company}storage.blob.core.windows.net',
] as const;

async function checkAzureBlob(containerUrl: string): Promise<BucketCheckResult> {
  try {
    const response = await axios.head(containerUrl, {
      timeout: 5000,
      validateStatus: () => true,
    });

    return {
      bucket: containerUrl,
      exists: response.status !== 404,
      public: response.status === 200,
      authenticated: response.status === 403,
    };
  } catch {
    return { bucket: containerUrl, exists: false, public: false, authenticated: false };
  }
}
```

**Google Cloud Storage**:
```typescript
const GCS_PATTERNS = [
  'storage.googleapis.com/{company}',
  '{company}.storage.googleapis.com',
] as const;

async function checkGcsBucket(bucketName: string): Promise<BucketCheckResult> {
  const url = `https://storage.googleapis.com/${bucketName}`;

  try {
    const response = await axios.head(url, {
      timeout: 5000,
      validateStatus: () => true,
    });

    return {
      bucket: bucketName,
      exists: response.status !== 404,
      public: response.status === 200,
      authenticated: response.status === 403,
    };
  } catch {
    return { bucket: bucketName, exists: false, public: false, authenticated: false };
  }
}
```

#### DNS Security Analysis

```typescript
import { Resolver } from 'dns';
import { promisify } from 'util';

const resolver = new Resolver();
const resolveTxt = promisify(resolver.resolveTxt.bind(resolver));

interface DnsSecurityResult {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'mail', 'dkim'] as const;

async function analyzeDnsSecurity(domain: string): Promise<DnsSecurityResult> {
  const security: DnsSecurityResult = {
    spf: null,
    dkim: null,
    dmarc: null,
  };

  // SPF Check
  try {
    const txtRecords = await resolveTxt(domain);
    for (const record of txtRecords) {
      const value = record.join('');
      if (value.includes('v=spf1')) {
        security.spf = value;
        break;
      }
    }
  } catch {
    // No TXT records or lookup failed
  }

  // DMARC Check
  try {
    const dmarcRecords = await resolveTxt(`_dmarc.${domain}`);
    if (dmarcRecords.length > 0) {
      security.dmarc = dmarcRecords[0].join('');
    }
  } catch {
    // No DMARC record
  }

  // DKIM Check (try common selectors)
  for (const selector of DKIM_SELECTORS) {
    try {
      const dkimRecords = await resolveTxt(`${selector}._domainkey.${domain}`);
      if (dkimRecords.length > 0) {
        security.dkim = dkimRecords[0].join('');
        break;
      }
    } catch {
      continue;
    }
  }

  return security;
}
```

### CVE Correlation

**NVD API Integration**:
```typescript
import axios from 'axios';

const NVD_API_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

interface NvdCveResponse {
  vulnerabilities: Array<{
    cve: {
      id: string;
      descriptions: Array<{ lang: string; value: string }>;
      metrics?: {
        cvssMetricV31?: Array<{
          cvssData: {
            baseScore: number;
            baseSeverity: string;
          };
        }>;
      };
    };
  }>;
}

async function lookupCves(cpe: string): Promise<NvdCveResponse['vulnerabilities']> {
  const response = await axios.get<NvdCveResponse>(NVD_API_BASE, {
    params: {
      cpeName: cpe,
      resultsPerPage: 100,
    },
    timeout: 30000,
  });

  return response.data.vulnerabilities ?? [];
}
```

**Service to CPE Mapping**:

Maps detected service banners to CPE (Common Platform Enumeration) strings for NVD lookup.

```typescript
const SERVICE_CPE_MAP: Record<string, string> = {
  // Web Servers
  'apache:2.4': 'cpe:2.3:a:apache:http_server:2.4:*:*:*:*:*:*:*',
  'apache:2.2': 'cpe:2.3:a:apache:http_server:2.2:*:*:*:*:*:*:*',
  'nginx:1.24': 'cpe:2.3:a:f5:nginx:1.24:*:*:*:*:*:*:*',
  'nginx:1.22': 'cpe:2.3:a:f5:nginx:1.22:*:*:*:*:*:*:*',
  'iis:10.0': 'cpe:2.3:a:microsoft:internet_information_services:10.0:*:*:*:*:*:*:*',
  'lighttpd:1.4': 'cpe:2.3:a:lighttpd:lighttpd:1.4:*:*:*:*:*:*:*',

  // SSH Servers
  'openssh:8.9': 'cpe:2.3:a:openbsd:openssh:8.9:*:*:*:*:*:*:*',
  'openssh:9.0': 'cpe:2.3:a:openbsd:openssh:9.0:*:*:*:*:*:*:*',
  'openssh:9.1': 'cpe:2.3:a:openbsd:openssh:9.1:*:*:*:*:*:*:*',
  'dropbear:2022': 'cpe:2.3:a:dropbear_ssh_project:dropbear_ssh:2022:*:*:*:*:*:*:*',

  // Databases
  'mysql:8.0': 'cpe:2.3:a:oracle:mysql:8.0:*:*:*:*:*:*:*',
  'mysql:5.7': 'cpe:2.3:a:oracle:mysql:5.7:*:*:*:*:*:*:*',
  'mariadb:10.11': 'cpe:2.3:a:mariadb:mariadb:10.11:*:*:*:*:*:*:*',
  'postgresql:15': 'cpe:2.3:a:postgresql:postgresql:15:*:*:*:*:*:*:*',
  'postgresql:14': 'cpe:2.3:a:postgresql:postgresql:14:*:*:*:*:*:*:*',
  'mssql:2019': 'cpe:2.3:a:microsoft:sql_server:2019:*:*:*:*:*:*:*',
  'mssql:2022': 'cpe:2.3:a:microsoft:sql_server:2022:*:*:*:*:*:*:*',
  'mongodb:7.0': 'cpe:2.3:a:mongodb:mongodb:7.0:*:*:*:*:*:*:*',
  'redis:7.2': 'cpe:2.3:a:redis:redis:7.2:*:*:*:*:*:*:*',

  // Mail Servers
  'postfix:3.8': 'cpe:2.3:a:postfix:postfix:3.8:*:*:*:*:*:*:*',
  'exim:4.96': 'cpe:2.3:a:exim:exim:4.96:*:*:*:*:*:*:*',
  'dovecot:2.3': 'cpe:2.3:a:dovecot:dovecot:2.3:*:*:*:*:*:*:*',
  'exchange:2019': 'cpe:2.3:a:microsoft:exchange_server:2019:*:*:*:*:*:*:*',

  // FTP Servers
  'vsftpd:3.0': 'cpe:2.3:a:vsftpd_project:vsftpd:3.0:*:*:*:*:*:*:*',
  'proftpd:1.3': 'cpe:2.3:a:proftpd:proftpd:1.3:*:*:*:*:*:*:*',
  'filezilla:1.7': 'cpe:2.3:a:filezilla-project:filezilla_server:1.7:*:*:*:*:*:*:*',

  // DNS Servers
  'bind:9.18': 'cpe:2.3:a:isc:bind:9.18:*:*:*:*:*:*:*',

  // Remote Access
  'rdp:10.0': 'cpe:2.3:a:microsoft:remote_desktop:10.0:*:*:*:*:*:*:*',
};

function buildCpeQuery(service: string, version: string): string | null {
  const serviceLower = service.toLowerCase();
  const versionMajor = version?.split('.')[0] ?? '';

  // Try exact match
  const exactKey = `${serviceLower}:${version}`;
  if (SERVICE_CPE_MAP[exactKey]) {
    return SERVICE_CPE_MAP[exactKey];
  }

  // Try major version match
  for (const [key, cpe] of Object.entries(SERVICE_CPE_MAP)) {
    const [svc, ver] = key.split(':');
    if (svc === serviceLower && ver.startsWith(versionMajor)) {
      // Replace version in CPE
      return cpe.replace(ver, version);
    }
  }

  return null;
}
```

**EPSS Score Integration**:
```typescript
const EPSS_API = 'https://api.first.org/data/v1/epss';

interface EpssResponse {
  data: Array<{
    cve: string;
    epss: string;
    percentile: string;
  }>;
}

async function getEpssScore(cveId: string): Promise<number> {
  try {
    const response = await axios.get<EpssResponse>(`${EPSS_API}?cve=${cveId}`, {
      timeout: 10000,
    });

    if (response.data.data?.length > 0) {
      return parseFloat(response.data.data[0].epss);
    }
  } catch {
    // EPSS lookup failed
  }

  return 0.0;
}
```

---

## Security Score Algorithm

### Score Calculation Formula

The Security Score is calculated as:

```
Security Score = 100 - PII_Penalty - ASM_Penalty

Where:
  PII_Penalty = Σ (pii_instance × pii_weight × decay_factor)
  ASM_Penalty = Σ (asm_finding × asm_weight)

  Maximum total penalty is capped at 100 (score floor = 0)
```

### PII Severity Weights

| PII Type | Weight | Max Penalty | Rationale |
|----------|--------|-------------|-----------|
| SSN | 10 | 30 | Highest identity theft risk |
| Credit Card | 10 | 30 | Direct financial risk |
| Bank Account | 8 | 24 | Financial risk |
| DOB | 5 | 15 | Identity verification data |
| Driver's License | 5 | 15 | Government ID |
| Passport | 5 | 15 | Government ID |
| Email | 2 | 10 | Low sensitivity, common |
| Phone | 2 | 10 | Low sensitivity, common |
| IP Address | 1 | 5 | Contextual sensitivity |
| MAC Address | 1 | 5 | Contextual sensitivity |

**Decay Factor** (diminishing returns for multiple instances):
```typescript
function calculateDecay(count: number): number {
  // First 10 instances: full weight
  // 11-50: 50% weight
  // 51+: 25% weight
  if (count <= 10) return 1.0;
  if (count <= 50) return 0.5;
  return 0.25;
}
```

### ASM Severity Weights

| Finding Type | Severity | Weight | Rationale |
|--------------|----------|--------|-----------|
| Critical CVE (CVSS 9.0-10.0) | Critical | 15 | Actively exploitable |
| High CVE (CVSS 7.0-8.9) | High | 10 | Significant risk |
| Medium CVE (CVSS 4.0-6.9) | Medium | 5 | Moderate risk |
| Low CVE (CVSS 0.1-3.9) | Low | 2 | Minor risk |
| Open RDP (3389) | Critical | 12 | Ransomware vector |
| Open Telnet (23) | Critical | 12 | Cleartext auth |
| Open VNC (5900) | Critical | 10 | Remote access |
| Open SSH (22) | High | 5 | Should be restricted |
| Open FTP (21) | High | 5 | Cleartext transfer |
| Open Database Port | High | 8 | Data exposure |
| Public S3 Bucket | High | 10 | Data exposure |
| Public Azure Blob | High | 10 | Data exposure |
| Public GCS Bucket | High | 10 | Data exposure |
| Missing SPF | Medium | 3 | Email spoofing |
| Missing DMARC | Medium | 3 | Email spoofing |
| Missing DKIM | Low | 2 | Email auth |

### Score Breakdown Categories

```typescript
interface ScoreBreakdown {
  pii: {
    subscore: number;           // 0-100, contribution to total
    weight: number;             // 0.4 (40% of total)
    findings: {
      high_severity: number;    // SSN, CC count
      medium_severity: number;  // DOB, DL count
      low_severity: number;     // Email, phone count
    };
  };
  vulnerabilities: {
    subscore: number;
    weight: number;             // 0.3 (30% of total)
    findings: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
  exposure: {
    subscore: number;
    weight: number;             // 0.2 (20% of total)
    findings: {
      risky_ports: number;
      cloud_storage: number;
    };
  };
  email_security: {
    subscore: number;
    weight: number;             // 0.1 (10% of total)
    findings: {
      spf_missing: boolean;
      dmarc_missing: boolean;
      dkim_missing: boolean;
    };
  };
}
```

### Risk Level Thresholds

| Score Range | Risk Level | Color | Label |
|-------------|------------|-------|-------|
| 0-39 | Critical | Red (#DC2626) | Critical Risk |
| 40-59 | High | Orange (#EA580C) | High Risk |
| 60-79 | Moderate | Yellow (#CA8A04) | Moderate Risk |
| 80-100 | Low | Green (#16A34A) | Low Risk |

### What-If Simulation

```typescript
interface WhatIfRequest {
  company_id: string;
  remediated_issues: string[];  // Issue IDs to simulate removal
}

interface WhatIfResponse {
  current_score: number;
  projected_score: number;
  improvement: number;
  remaining_issues: Issue[];
  new_risk_level: RiskLevel;
}

function calculateWhatIf(request: WhatIfRequest): WhatIfResponse {
  const currentScore = getCurrentScore(request.company_id);
  const currentIssues = getTopIssues(request.company_id);

  const remainingIssues = currentIssues.filter(
    issue => !request.remediated_issues.includes(issue.id)
  );

  const projectedPenalty = remainingIssues.reduce(
    (sum, issue) => sum + issue.score_impact,
    0
  );

  const projectedScore = Math.max(0, Math.min(100, 100 - projectedPenalty));

  return {
    current_score: currentScore.score,
    projected_score: projectedScore,
    improvement: projectedScore - currentScore.score,
    remaining_issues: remainingIssues,
    new_risk_level: getRiskLevel(projectedScore),
  };
}
```

---

## Database Schema (DDL)

### Core Tables

```sql
-- =============================================================================
-- PII Scanner Tables
-- =============================================================================

CREATE TYPE guard_pii_type AS ENUM (
  'ssn', 'credit_card', 'bank_account', 'dob', 'drivers_license',
  'passport', 'email', 'phone', 'ip_address', 'mac_address'
);

CREATE TYPE guard_job_status AS ENUM (
  'queued', 'running', 'completed', 'failed', 'cancelled'
);

CREATE TABLE guard_pii_profiles (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  name TEXT NOT NULL,
  description TEXT,
  pii_types JSONB NOT NULL DEFAULT '[]',  -- Array of guard_pii_type
  file_extensions JSONB NOT NULL DEFAULT '["txt","pdf","xls","xlsx","doc","docx","zip"]',
  target_companies JSONB,                  -- null = all companies
  target_agents JSONB,                     -- null = all agents in target_companies
  include_paths JSONB NOT NULL DEFAULT '[]',
  exclude_paths JSONB NOT NULL DEFAULT '[]',
  max_file_size_mb INTEGER DEFAULT 50,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id),

  PRIMARY KEY (id, tenant)
);

CREATE INDEX idx_guard_pii_profiles_tenant ON guard_pii_profiles(tenant);
CREATE INDEX idx_guard_pii_profiles_enabled ON guard_pii_profiles(tenant, enabled);

CREATE TABLE guard_pii_jobs (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  profile_id UUID NOT NULL,
  status guard_job_status NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_files_scanned INTEGER DEFAULT 0,
  total_matches INTEGER DEFAULT 0,
  error_message TEXT,
  progress_percent INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',            -- Agent progress details

  PRIMARY KEY (id, tenant),
  FOREIGN KEY (profile_id, tenant) REFERENCES guard_pii_profiles(id, tenant)
);

CREATE INDEX idx_guard_pii_jobs_tenant ON guard_pii_jobs(tenant);
CREATE INDEX idx_guard_pii_jobs_status ON guard_pii_jobs(tenant, status);
CREATE INDEX idx_guard_pii_jobs_profile ON guard_pii_jobs(tenant, profile_id);

CREATE TABLE guard_pii_results (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  job_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  company_id UUID NOT NULL,
  asset_id UUID,
  agent_id UUID,
  pii_type guard_pii_type NOT NULL,
  file_path TEXT NOT NULL,
  line_numbers JSONB NOT NULL DEFAULT '[]',   -- Array of integers
  page_numbers JSONB,                          -- For PDFs
  confidence DECIMAL(3,2) DEFAULT 1.0,         -- 0.00 - 1.00
  found_at TIMESTAMPTZ DEFAULT NOW(),
  -- NOTE: No actual_value column - by design

  PRIMARY KEY (id, tenant),
  FOREIGN KEY (job_id, tenant) REFERENCES guard_pii_jobs(id, tenant),
  FOREIGN KEY (profile_id, tenant) REFERENCES guard_pii_profiles(id, tenant),
  FOREIGN KEY (company_id, tenant) REFERENCES companies(id, tenant)
);

CREATE INDEX idx_guard_pii_results_tenant ON guard_pii_results(tenant);
CREATE INDEX idx_guard_pii_results_job ON guard_pii_results(tenant, job_id);
CREATE INDEX idx_guard_pii_results_company ON guard_pii_results(tenant, company_id);
CREATE INDEX idx_guard_pii_results_type ON guard_pii_results(tenant, pii_type);
CREATE INDEX idx_guard_pii_results_found ON guard_pii_results(tenant, found_at DESC);

-- =============================================================================
-- Attack Surface Mapper Tables
-- =============================================================================

CREATE TYPE guard_asm_result_type AS ENUM (
  'subdomain', 'ip_address', 'open_port', 'service', 'cve',
  'dns_record', 'http_header', 'cloud_storage', 'email_security'
);

CREATE TABLE guard_asm_domains (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  company_id UUID NOT NULL,
  domain_name TEXT NOT NULL,
  ownership_verified BOOLEAN DEFAULT false,
  last_scanned_at TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id),

  PRIMARY KEY (id, tenant),
  FOREIGN KEY (company_id, tenant) REFERENCES companies(id, tenant),
  UNIQUE (tenant, domain_name)
);

CREATE INDEX idx_guard_asm_domains_tenant ON guard_asm_domains(tenant);
CREATE INDEX idx_guard_asm_domains_company ON guard_asm_domains(tenant, company_id);

CREATE TABLE guard_asm_jobs (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  domain_id UUID NOT NULL,
  status guard_job_status NOT NULL DEFAULT 'queued',
  scanner_pod_id TEXT,                    -- Which pod executed this
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  summary JSONB DEFAULT '{}',             -- Quick stats for UI

  PRIMARY KEY (id, tenant),
  FOREIGN KEY (domain_id, tenant) REFERENCES guard_asm_domains(id, tenant)
);

CREATE INDEX idx_guard_asm_jobs_tenant ON guard_asm_jobs(tenant);
CREATE INDEX idx_guard_asm_jobs_domain ON guard_asm_jobs(tenant, domain_id);
CREATE INDEX idx_guard_asm_jobs_status ON guard_asm_jobs(tenant, status);

CREATE TABLE guard_asm_results (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  job_id UUID NOT NULL,
  domain_id UUID NOT NULL,
  result_type guard_asm_result_type NOT NULL,
  data JSONB NOT NULL,                    -- Flexible schema per result_type
  severity TEXT,                          -- critical, high, medium, low, info
  found_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (id, tenant),
  FOREIGN KEY (job_id, tenant) REFERENCES guard_asm_jobs(id, tenant),
  FOREIGN KEY (domain_id, tenant) REFERENCES guard_asm_domains(id, tenant)
);

CREATE INDEX idx_guard_asm_results_tenant ON guard_asm_results(tenant);
CREATE INDEX idx_guard_asm_results_job ON guard_asm_results(tenant, job_id);
CREATE INDEX idx_guard_asm_results_domain ON guard_asm_results(tenant, domain_id);
CREATE INDEX idx_guard_asm_results_type ON guard_asm_results(tenant, result_type);
CREATE INDEX idx_guard_asm_results_severity ON guard_asm_results(tenant, severity);

-- =============================================================================
-- Scheduling Tables
-- =============================================================================

CREATE TYPE guard_schedule_type AS ENUM ('pii', 'asm');
CREATE TYPE guard_schedule_frequency AS ENUM ('daily', 'weekly', 'monthly');

CREATE TABLE guard_schedules (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  schedule_type guard_schedule_type NOT NULL,
  target_id UUID NOT NULL,                -- profile_id or domain_id
  frequency guard_schedule_frequency NOT NULL,
  day_of_week INTEGER,                    -- 0-6 for weekly (0=Sunday)
  day_of_month INTEGER,                   -- 1-31 for monthly
  time_of_day TIME NOT NULL DEFAULT '02:00',  -- When to run
  timezone TEXT NOT NULL DEFAULT 'UTC',
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_job_id UUID,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (id, tenant)
);

CREATE INDEX idx_guard_schedules_tenant ON guard_schedules(tenant);
CREATE INDEX idx_guard_schedules_next_run ON guard_schedules(enabled, next_run_at);
CREATE INDEX idx_guard_schedules_type ON guard_schedules(tenant, schedule_type);

-- =============================================================================
-- Security Score Tables
-- =============================================================================

CREATE TYPE guard_risk_level AS ENUM ('critical', 'high', 'moderate', 'low');

CREATE TABLE guard_security_scores (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  company_id UUID NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  risk_level guard_risk_level NOT NULL,
  pii_subscore INTEGER NOT NULL DEFAULT 100,
  asm_subscore INTEGER NOT NULL DEFAULT 100,
  breakdown JSONB NOT NULL DEFAULT '{}',
  top_issues JSONB NOT NULL DEFAULT '[]',
  previous_score INTEGER,
  score_delta INTEGER,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  triggered_by_pii_job_id UUID,
  triggered_by_asm_job_id UUID,

  PRIMARY KEY (id, tenant),
  FOREIGN KEY (company_id, tenant) REFERENCES companies(id, tenant),
  UNIQUE (tenant, company_id)             -- One current score per company
);

CREATE INDEX idx_guard_security_scores_tenant ON guard_security_scores(tenant);
CREATE INDEX idx_guard_security_scores_company ON guard_security_scores(tenant, company_id);
CREATE INDEX idx_guard_security_scores_level ON guard_security_scores(tenant, risk_level);
CREATE INDEX idx_guard_security_scores_score ON guard_security_scores(tenant, score);

CREATE TABLE guard_security_score_history (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  company_id UUID NOT NULL,
  score INTEGER NOT NULL,
  risk_level guard_risk_level NOT NULL,
  breakdown JSONB NOT NULL DEFAULT '{}',
  recorded_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (id, tenant),
  FOREIGN KEY (company_id, tenant) REFERENCES companies(id, tenant)
);

CREATE INDEX idx_guard_score_history_tenant ON guard_security_score_history(tenant);
CREATE INDEX idx_guard_score_history_company ON guard_security_score_history(tenant, company_id);
CREATE INDEX idx_guard_score_history_date ON guard_security_score_history(tenant, company_id, recorded_at DESC);

-- =============================================================================
-- Report Jobs Table
-- =============================================================================

CREATE TYPE guard_report_type AS ENUM ('pii', 'asm', 'security_score');
CREATE TYPE guard_report_format AS ENUM ('word', 'excel', 'pdf');

CREATE TABLE guard_report_jobs (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  report_type guard_report_type NOT NULL,
  report_format guard_report_format NOT NULL,
  status guard_job_status NOT NULL DEFAULT 'queued',
  filters JSONB NOT NULL DEFAULT '{}',    -- date_range, company_ids, etc.
  file_path TEXT,                         -- S3 path when complete
  download_url TEXT,                      -- Signed URL
  download_url_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (id, tenant)
);

CREATE INDEX idx_guard_report_jobs_tenant ON guard_report_jobs(tenant);
CREATE INDEX idx_guard_report_jobs_status ON guard_report_jobs(tenant, status);

-- =============================================================================
-- Audit Log Table
-- =============================================================================

CREATE TABLE guard_audit_log (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  user_id UUID,
  action TEXT NOT NULL,                   -- 'profile_created', 'scan_triggered', etc.
  resource_type TEXT NOT NULL,            -- 'pii_profile', 'asm_domain', etc.
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (id, tenant)
);

CREATE INDEX idx_guard_audit_log_tenant ON guard_audit_log(tenant);
CREATE INDEX idx_guard_audit_log_action ON guard_audit_log(tenant, action);
CREATE INDEX idx_guard_audit_log_date ON guard_audit_log(tenant, created_at DESC);
```

### ASM Result Data Schemas (JSONB)

```typescript
// result_type: 'subdomain'
interface SubdomainData {
  name: string;           // "mail.example.com"
  source: string;         // "dns_brute", "cert_transparency", "zone_transfer"
  resolved_ips: string[];
}

// result_type: 'ip_address'
interface IpAddressData {
  ip: string;
  version: 4 | 6;
  hostname: string;
  geolocation: {
    country_code: string;
    country_name: string;
    city: string;
    latitude: number;
    longitude: number;
  };
  asn: {
    number: number;
    name: string;
  };
}

// result_type: 'open_port'
interface OpenPortData {
  ip: string;
  port: number;
  protocol: 'tcp' | 'udp';
  state: 'open' | 'filtered';
  service: string;        // "ssh", "http", etc.
  version: string;        // "OpenSSH 8.9"
  banner: string;
}

// result_type: 'cve'
interface CveData {
  cve_id: string;         // "CVE-2023-1234"
  service: string;
  version: string;
  cvss_v3: {
    score: number;
    vector: string;
    severity: string;
  };
  epss: {
    score: number;
    percentile: number;
  };
  description: string;
  references: string[];
}

// result_type: 'dns_record'
interface DnsRecordData {
  record_type: 'A' | 'AAAA' | 'NS' | 'MX' | 'TXT' | 'SOA' | 'CNAME';
  name: string;
  value: string;
  ttl: number;
  priority?: number;      // For MX records
}

// result_type: 'http_header'
interface HttpHeaderData {
  url: string;
  status_code: number;
  headers: Record<string, string>;
  security_headers: {
    content_security_policy: boolean;
    x_frame_options: boolean;
    x_content_type_options: boolean;
    strict_transport_security: boolean;
    x_xss_protection: boolean;
  };
}

// result_type: 'cloud_storage'
interface CloudStorageData {
  provider: 's3' | 'azure_blob' | 'gcs';
  bucket_name: string;
  url: string;
  is_public: boolean;
  allows_listing: boolean;
  sample_files?: string[];  // First 5 file names if listing allowed
}

// result_type: 'email_security'
interface EmailSecurityData {
  spf: {
    exists: boolean;
    record: string | null;
    policy: 'fail' | 'softfail' | 'neutral' | 'none';
  };
  dmarc: {
    exists: boolean;
    record: string | null;
    policy: 'none' | 'quarantine' | 'reject';
  };
  dkim: {
    exists: boolean;
    selector: string | null;
    record: string | null;
  };
}
```

---

## Job Queue Integration (PG Boss)

### Job Handlers

```typescript
// /server/src/lib/jobs/handlers/guard/

// PII Scan Job
interface PiiScanJobData {
  tenant: string;
  job_id: string;
  profile_id: string;
  target_agents: string[];
}

export const piiScanHandler: JobHandler<PiiScanJobData> = {
  name: 'guard:pii:scan',
  config: {
    retryLimit: 3,
    retryBackoff: true,
    expireInHours: 24,
  },
  async handler(job) {
    const { tenant, job_id, profile_id, target_agents } = job.data;
    // 1. Update job status to 'running'
    // 2. Dispatch scan requests to target agents
    // 3. Wait for agent responses
    // 4. Aggregate results
    // 5. Update job status to 'completed'
    // 6. Trigger security score recalculation
  },
};

// ASM Scan Job
interface AsmScanJobData {
  tenant: string;
  job_id: string;
  domain_id: string;
  domain_name: string;
}

export const asmScanHandler: JobHandler<AsmScanJobData> = {
  name: 'guard:asm:scan',
  config: {
    retryLimit: 2,
    retryBackoff: true,
    expireInHours: 2,
  },
  async handler(job) {
    // 1. Update job status to 'running'
    // 2. Execute ASM scanner (subprocess or external service)
    // 3. Parse and store results
    // 4. Update job status to 'completed'
    // 5. Trigger security score recalculation
  },
};

// Score Recalculation Job
interface ScoreRecalcJobData {
  tenant: string;
  company_id: string;
  triggered_by: 'pii_job' | 'asm_job' | 'manual';
  trigger_job_id?: string;
}

export const scoreRecalcHandler: JobHandler<ScoreRecalcJobData> = {
  name: 'guard:score:recalc',
  config: {
    retryLimit: 3,
    retryBackoff: true,
  },
  async handler(job) {
    // 1. Fetch all PII results for company
    // 2. Fetch all ASM results for company's domains
    // 3. Calculate score using algorithm
    // 4. Update security_scores table
    // 5. Insert into security_score_history
  },
};

// Report Generation Job
interface ReportJobData {
  tenant: string;
  report_job_id: string;
  report_type: 'pii' | 'asm' | 'security_score';
  format: 'word' | 'excel' | 'pdf';
  filters: Record<string, any>;
}

export const reportGenerationHandler: JobHandler<ReportJobData> = {
  name: 'guard:report:generate',
  config: {
    retryLimit: 2,
    expireInHours: 1,
  },
  async handler(job) {
    // 1. Fetch data based on filters
    // 2. Generate report using appropriate library
    // 3. Upload to S3
    // 4. Generate signed URL
    // 5. Update report_jobs table
  },
};

// Scheduled Scan Processor
export const scheduledScanProcessor: JobHandler<void> = {
  name: 'guard:schedules:process',
  config: {
    retryLimit: 1,
  },
  async handler() {
    // Runs every minute via cron
    // 1. Query schedules where next_run_at <= NOW() and enabled = true
    // 2. For each schedule, create appropriate scan job
    // 3. Update next_run_at based on frequency
  },
};
```

### Cron Schedule Registration

```typescript
// /server/src/lib/jobs/schedules/guard.ts

import { pgBoss } from '../runners/PgBossJobRunner';

export function registerGuardSchedules() {
  // Process scheduled scans every minute
  pgBoss.schedule('guard:schedules:process', '* * * * *', {});

  // Daily CVE database sync at 3 AM UTC
  pgBoss.schedule('guard:cve:sync', '0 3 * * *', {});

  // Weekly cleanup of old results (based on retention policy)
  pgBoss.schedule('guard:cleanup:expired', '0 4 * * 0', {});
}
```

---

## Event Bus Integration

### Event Types

Add to `/server/src/lib/eventBus/events.ts`:

```typescript
export const GUARD_EVENTS = {
  // PII Events
  PII_SCAN_STARTED: 'guard:pii:scan_started',
  PII_SCAN_COMPLETED: 'guard:pii:scan_completed',
  PII_SCAN_FAILED: 'guard:pii:scan_failed',
  PII_HIGH_SEVERITY_FOUND: 'guard:pii:high_severity_found',

  // ASM Events
  ASM_SCAN_STARTED: 'guard:asm:scan_started',
  ASM_SCAN_COMPLETED: 'guard:asm:scan_completed',
  ASM_SCAN_FAILED: 'guard:asm:scan_failed',
  ASM_CRITICAL_CVE_FOUND: 'guard:asm:critical_cve_found',
  ASM_EXPOSED_SERVICE_FOUND: 'guard:asm:exposed_service_found',

  // Score Events
  SCORE_UPDATED: 'guard:score:updated',
  SCORE_CRITICAL_THRESHOLD: 'guard:score:critical_threshold',
  SCORE_IMPROVED: 'guard:score:improved',
  SCORE_DECLINED: 'guard:score:declined',

  // Report Events
  REPORT_READY: 'guard:report:ready',
} as const;
```

### Event Payloads

```typescript
interface PiiScanCompletedEvent {
  tenant: string;
  job_id: string;
  profile_name: string;
  total_findings: number;
  high_severity_count: number;
  companies_affected: string[];
}

interface ScoreUpdatedEvent {
  tenant: string;
  company_id: string;
  company_name: string;
  previous_score: number;
  new_score: number;
  delta: number;
  risk_level: string;
  top_issues: Array<{
    type: string;
    description: string;
    impact: number;
  }>;
}
```

### Notification Subscribers

```typescript
// /server/src/lib/eventBus/subscribers/guardNotifications.ts

import { eventBus } from '../index';
import { sendEmail } from '@/services/emailService';
import { GUARD_EVENTS } from '../events';

eventBus.subscribe(GUARD_EVENTS.PII_HIGH_SEVERITY_FOUND, async (event) => {
  const { tenant, company_name, finding_type, file_count } = event.data;

  // Get notification recipients for tenant
  const recipients = await getGuardNotificationRecipients(tenant);

  await sendEmail({
    to: recipients,
    subject: `[Alga Guard] High Severity PII Found - ${company_name}`,
    template: 'guard-pii-alert',
    data: { finding_type, file_count, company_name },
  });
});

eventBus.subscribe(GUARD_EVENTS.SCORE_CRITICAL_THRESHOLD, async (event) => {
  const { tenant, company_name, score, previous_score } = event.data;

  await sendEmail({
    to: await getGuardNotificationRecipients(tenant),
    subject: `[Alga Guard] Security Score Critical - ${company_name}`,
    template: 'guard-score-critical',
    data: { company_name, score, previous_score, drop: previous_score - score },
  });
});
```

---

## Extension Runner Architecture

Alga Guard's PII Scanner operates as an **Alga PSA Extension** using the Extension Runner infrastructure. This section documents the actual communication protocol and integration patterns.

### Overview

The PII Scanner is packaged as a WASM extension that runs on customer endpoints via the Alga PSA agent system. Communication follows the Extension Runner protocol:

```
┌─────────────────┐    HTTP POST      ┌─────────────────┐    WASM     ┌─────────────────┐
│   Alga Guard    │ ───────────────→ │ Extension Runner │ ─────────→ │  PII Scanner    │
│   Job Handler   │ ←─────────────── │   (on Agent)     │ ←───────── │    Extension    │
└─────────────────┘    JSON Response  └─────────────────┘            └─────────────────┘
```

### Extension Registration

The PII Scanner extension is registered in the `tenant_extension_install` table:

```sql
-- Extension registration (per tenant)
INSERT INTO tenant_extension_install (
  tenant,
  extension_id,
  version_id,
  install_id,
  content_hash,
  config,
  enabled
) VALUES (
  :tenant_id,
  'alga-guard-pii-scanner',
  'v1.0.0',
  gen_random_uuid(),
  :wasm_content_hash,
  '{"default_pii_types": ["ssn", "credit_card"]}',
  true
);
```

### Extension Runner Protocol

Communication uses HTTP POST to the Extension Runner's `/v1/execute` endpoint. The protocol is request-response (not streaming).

#### Request Format (Server → Runner)

```typescript
interface ExtensionExecuteRequest {
  context: {
    request_id: string;           // Unique request identifier (UUID)
    tenant_id: string;            // Tenant UUID
    extension_id: string;         // 'alga-guard-pii-scanner'
    install_id: string;           // Installation instance UUID
    version_id: string;           // Extension version
    content_hash: string;         // WASM binary hash for verification
    config: Record<string, string>; // Tenant-specific configuration
    trigger: 'schedule' | 'http'; // How the execution was triggered
    schedule_id?: string;         // If triggered by schedule
  };
  http: {
    method: 'POST';               // Always POST for scan requests
    path: '/scan';                // Extension-specific path
    query: Record<string, string>;
    headers: Record<string, string>;
    body_b64: string;             // Base64-encoded PiiScanRequest JSON
  };
  limits: {
    timeout_ms: number;           // Max execution time (default: 3600000 = 1hr)
  };
  providers?: string[];           // Optional capability providers
  secret_envelope?: unknown;      // Encrypted secrets if needed
}
```

#### Response Format (Runner → Server)

```typescript
interface ExtensionExecuteResponse {
  status: number;                 // HTTP-like status code (200, 400, 500)
  headers: Record<string, string>;
  body_b64: string;               // Base64-encoded response JSON
  error?: string;                 // Error message if status >= 400
}
```

### PII Scan Request/Response Payloads

The `body_b64` field contains Base64-encoded JSON. For PII scans:

#### Scan Request (in http.body_b64)

```typescript
interface PiiScanRequest {
  job_id: string;                 // Guard job UUID for correlation
  profile: {
    pii_types: PiiType[];         // Which PII patterns to scan for
    file_extensions: string[];    // File types to include
    include_paths: string[];      // Paths to scan (supports wildcards)
    exclude_paths: string[];      // Paths to skip (supports wildcards)
    max_file_size_mb: number;     // Skip files larger than this
    max_files: number;            // Stop after this many files
  };
  reporting: {
    batch_size: number;           // Results per response (default: 100)
    include_context: boolean;     // Whether to include surrounding text hash
  };
}

type PiiType =
  | 'ssn' | 'credit_card' | 'bank_account'
  | 'dob' | 'drivers_license' | 'passport'
  | 'email' | 'phone' | 'ip_address' | 'mac_address';
```

#### Scan Response (in response body_b64)

```typescript
interface PiiScanResponse {
  job_id: string;
  status: 'completed' | 'failed' | 'partial';
  results: PiiMatch[];
  summary: {
    files_scanned: number;
    files_skipped: number;
    total_matches: number;
    by_type: Record<PiiType, number>;
    scan_duration_ms: number;
    errors: ScanError[];
  };
}

interface PiiMatch {
  pii_type: PiiType;
  file_path: string;              // Relative path from scan root
  line_numbers: number[];         // For text files
  page_numbers?: number[];        // For PDFs
  confidence: number;             // 0.0 - 1.0
  context_hash?: string;          // SHA256 of surrounding context (for dedup)
}

interface ScanError {
  file_path: string;
  error_code: 'FILE_TOO_LARGE' | 'ENCODING_ERROR' | 'PERMISSION_DENIED' | 'CORRUPT_FILE';
  message: string;
}
```

### Job Queue Integration for Agent Scans

PII scans use the **Job Queue pathway** (async) rather than HTTP Gateway (sync) because scans are long-running operations.

#### Triggering a Scan

```typescript
// /server/src/lib/jobs/handlers/guard/piiScanHandler.ts

import { pgBoss } from '@/lib/scheduling/pgBossManager';
import { executeExtension } from '@/lib/extensions/executor';

interface PiiScanJobData {
  tenant: string;
  job_id: string;              // guard_pii_jobs.id
  profile_id: string;          // guard_pii_profiles.id
  target_agents: string[];     // Agent IDs to scan
}

export async function enqueuePiiScan(data: PiiScanJobData): Promise<string> {
  return pgBoss.send('guard:pii:scan', data, {
    retryLimit: 3,
    retryBackoff: true,
    expireInHours: 24,
    singletonKey: `pii-scan-${data.profile_id}`, // Prevent duplicate scans
  });
}

export async function handlePiiScan(job: Job<PiiScanJobData>): Promise<void> {
  const { tenant, job_id, profile_id, target_agents } = job.data;

  // 1. Update job status to 'running'
  await updateJobStatus(job_id, 'running');

  // 2. Load scan profile
  const profile = await getPiiProfile(profile_id, tenant);

  // 3. For each target agent, dispatch via extension runner
  const results: PiiScanResponse[] = [];
  for (const agentId of target_agents) {
    try {
      const response = await executeExtension({
        tenant_id: tenant,
        extension_id: 'alga-guard-pii-scanner',
        agent_id: agentId,
        request: {
          method: 'POST',
          path: '/scan',
          body: buildScanRequest(job_id, profile),
        },
        timeout_ms: 3600000, // 1 hour max per agent
      });

      results.push(JSON.parse(atob(response.body_b64)));
    } catch (error) {
      await recordAgentError(job_id, agentId, error);
    }
  }

  // 4. Aggregate results into guard_pii_results table
  await persistResults(job_id, profile_id, tenant, results);

  // 5. Update job status to 'completed'
  await updateJobStatus(job_id, 'completed', {
    total_files_scanned: sumBy(results, r => r.summary.files_scanned),
    total_matches: sumBy(results, r => r.summary.total_matches),
  });

  // 6. Trigger security score recalculation
  await pgBoss.send('guard:score:recalc', {
    tenant,
    company_id: await getCompanyForAgents(target_agents),
    triggered_by: 'pii_job',
    trigger_job_id: job_id,
  });
}
```

### Extension HTTP Gateway (Alternative Path)

For real-time or interactive scans (e.g., "scan this one file"), the HTTP Gateway provides synchronous execution:

**Route**: `/api/ext/alga-guard-pii-scanner/scan`

```typescript
// Example: Direct API call for single-file scan
POST /api/ext/alga-guard-pii-scanner/scan
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "file_path": "/Users/john/Documents/sensitive.xlsx",
  "pii_types": ["ssn", "credit_card"]
}
```

The HTTP Gateway (`/server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`) proxies this to the extension runner.

### Job Tracking Database Tables

Alga Guard uses its own job tables (`guard_pii_jobs`, `guard_asm_jobs`) but also integrates with the unified job tracking system:

```typescript
// Relationship between Alga Guard jobs and unified job system
interface UnifiedJobRecord {
  id: string;                     // UUID
  tenant: string;
  job_type: 'guard:pii:scan' | 'guard:asm:scan' | 'guard:score:recalc';
  runner_type: 'pgboss' | 'temporal';  // CE uses pgboss, EE uses temporal
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;
}
```

### Progress Reporting

For long-running scans, progress is reported via PG Boss job metadata updates:

```typescript
// In the extension (WASM side) - not directly, but via runner callbacks
// The server polls job progress and updates the UI

// Server-side polling for progress
async function pollScanProgress(jobId: string): Promise<ScanProgress> {
  const job = await pgBoss.getJobById(jobId);
  return {
    status: job.state,
    progress: job.output?.progress_percent ?? 0,
    files_scanned: job.output?.files_scanned ?? 0,
    matches_found: job.output?.matches_found ?? 0,
    current_file: job.output?.current_file ?? null,
  };
}
```

### Error Handling

```typescript
// Extension runner error codes
const RUNNER_ERRORS = {
  EXTENSION_NOT_FOUND: { status: 404, message: 'Extension not installed' },
  AGENT_OFFLINE: { status: 503, message: 'Agent not connected' },
  TIMEOUT: { status: 504, message: 'Scan exceeded timeout' },
  WASM_ERROR: { status: 500, message: 'Extension execution failed' },
  PERMISSION_DENIED: { status: 403, message: 'Insufficient permissions' },
} as const;

// Job handler error recovery
async function handlePiiScanWithRetry(job: Job<PiiScanJobData>): Promise<void> {
  try {
    await handlePiiScan(job);
  } catch (error) {
    if (error.code === 'AGENT_OFFLINE') {
      // Retry later - PG Boss handles this via retryLimit
      throw error;
    }
    if (error.code === 'TIMEOUT') {
      // Mark job as partial completion
      await updateJobStatus(job.data.job_id, 'completed', {
        partial: true,
        reason: 'Scan timed out before completion',
      });
    } else {
      // Fatal error
      await updateJobStatus(job.data.job_id, 'failed', {
        error: error.message,
      });
      throw error;
    }
  }
}
```

### Authentication Flow

```
1. User triggers scan via UI
2. Server validates session (NextAuth getServerSession())
3. Server checks guard:pii:execute_scan permission
4. Server enqueues job to PG Boss
5. Job handler loads tenant context
6. Handler calls extension executor with tenant credentials
7. Extension runner authenticates with agent using install_id + content_hash
8. Agent executes WASM extension in sandboxed environment
9. Results flow back through same path
```

---

## Endpoint Agent Implementation

### Architecture Clarification

Alga PSA has two distinct WASM execution environments:

| Component | Location | Purpose | File System Access |
|-----------|----------|---------|-------------------|
| **Extension Runner** | Server-side (Kubernetes) | General extension execution | No direct FS - uses KV storage API |
| **Endpoint Agent** | Customer workstations | RMM agent with local scanning | Yes - full local FS access |

**The PII Scanner runs on the Endpoint Agent**, not the server-side Extension Runner. This is required because:
1. PII data must be scanned locally (never transmitted to server)
2. File system access is needed to scan documents
3. Platform-specific path handling is required

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Alga PSA Server                                │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │   Job Handler   │───▶│ Extension Runner │    │  Results Storage  │  │
│  │  (PG Boss)      │    │ (Server WASM)    │    │  (PostgreSQL)     │  │
│  └────────┬────────┘    └──────────────────┘    └─────────▲─────────┘  │
│           │                                                │            │
└───────────┼────────────────────────────────────────────────┼────────────┘
            │ HTTP POST /v1/execute                          │
            ▼                                                │
┌─────────────────────────────────────────────────────────────────────────┐
│                     Customer Endpoint (Windows/Mac/Linux)               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       Endpoint Agent                             │   │
│  │  ┌───────────────┐   ┌───────────────┐   ┌───────────────────┐  │   │
│  │  │  HTTP Server  │──▶│ WASM Runtime  │──▶│  PII Scanner Ext  │  │   │
│  │  │  (listens)    │   │ (Wasmtime)    │   │  (Rust/WASM)      │  │   │
│  │  └───────────────┘   └───────────────┘   └─────────┬─────────┘  │   │
│  │                                                     │            │   │
│  │                        ┌────────────────────────────┘            │   │
│  │                        ▼                                         │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │              Host Capabilities (Rust)                    │    │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │    │   │
│  │  │  │ cap:fs.read │  │ cap:fs.walk │  │ cap:fs.metadata │  │    │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────┘  │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Local File System                             │   │
│  │   C:\Users\*\Documents\*.xlsx  |  /home/*/Documents/*.pdf       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Endpoint Agent WASM Runtime

The endpoint agent embeds a Wasmtime runtime similar to the server-side runner, but with additional capabilities for local file system access.

**Runtime Configuration**:
```rust
// endpoint-agent/src/runtime/config.rs

use wasmtime::{Config, Engine, PoolingAllocationConfig};

pub fn create_engine_config() -> Config {
    let mut config = Config::new();
    config.async_support(true);
    config.wasm_component_model(true);
    config.epoch_interruption(true);

    // Memory limits for endpoint scanning
    let mut pooling = PoolingAllocationConfig::default();
    pooling.max_memory_size(512 * 1024 * 1024);  // 512 MB per instance
    pooling.total_memories(4);                     // Max 4 concurrent scans
    pooling.total_tables(16);
    pooling.total_stacks(8);

    config.allocation_strategy(
        wasmtime::InstanceAllocationStrategy::Pooling(pooling)
    );

    config
}
```

### File System Capability Interface (WIT)

The endpoint agent exposes file system capabilities to WASM extensions via WIT (WebAssembly Interface Types):

```wit
// endpoint-agent/wit/filesystem.wit

package alga:endpoint;

interface filesystem {
    /// File metadata
    record file-info {
        path: string,
        size: u64,
        is-dir: bool,
        is-symlink: bool,
        modified-ms: u64,
        readonly: bool,
    }

    /// Read file contents
    read-file: func(path: string, max-bytes: u64) -> result<list<u8>, fs-error>;

    /// Read file as text with encoding detection
    read-text: func(path: string, max-bytes: u64) -> result<string, fs-error>;

    /// Get file metadata
    get-metadata: func(path: string) -> result<file-info, fs-error>;

    /// Walk directory tree with filters
    walk-directory: func(
        root: string,
        include-patterns: list<string>,
        exclude-patterns: list<string>,
        max-depth: u32,
        max-files: u32,
    ) -> result<list<file-info>, fs-error>;

    /// Check if path matches glob pattern
    matches-glob: func(path: string, pattern: string) -> bool;

    /// Error types
    variant fs-error {
        not-found,
        permission-denied,
        is-directory,
        file-too-large,
        encoding-error,
        io-error(string),
    }
}
```

### Platform-Specific Code Splitting

The endpoint agent handles platform differences using Rust's conditional compilation:

```rust
// endpoint-agent/src/host/filesystem.rs

use std::path::{Path, PathBuf};

/// Normalize path for current platform
pub fn normalize_path(path: &str) -> PathBuf {
    #[cfg(windows)]
    {
        // Windows: Handle drive letters, backslashes, UNC paths
        let path = path.replace('/', "\\");
        if path.starts_with("\\\\") {
            // UNC path: \\server\share
            PathBuf::from(path)
        } else if path.len() >= 2 && path.chars().nth(1) == Some(':') {
            // Drive letter: C:\Users\...
            PathBuf::from(path)
        } else {
            // Relative path
            PathBuf::from(path)
        }
    }

    #[cfg(not(windows))]
    {
        // Unix: Forward slashes, no drive letters
        PathBuf::from(path)
    }
}

/// Expand user home directory
pub fn expand_home(path: &str) -> PathBuf {
    if path.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]);  // Skip "~/"
        }
    }
    PathBuf::from(path)
}

/// Default scan paths per platform
pub fn default_scan_paths() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        vec![
            PathBuf::from(r"C:\Users"),
            PathBuf::from(r"C:\ProgramData"),
        ]
    }

    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/Users"),
            PathBuf::from("/Volumes"),
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            PathBuf::from("/home"),
            PathBuf::from("/root"),
        ]
    }
}

/// Check if file should be skipped (system/hidden files)
pub fn should_skip_file(path: &Path) -> bool {
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        // Skip Windows system/hidden files
        if let Ok(meta) = path.metadata() {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
            let attrs = meta.file_attributes();
            if attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0 {
                return true;
            }
        }

        // Skip known Windows system directories
        let skip_dirs = ["Windows", "Program Files", "Program Files (x86)", "$Recycle.Bin"];
        if skip_dirs.iter().any(|d| file_name.eq_ignore_ascii_case(d)) {
            return true;
        }
    }

    #[cfg(unix)]
    {
        // Skip Unix hidden files (starting with .)
        if file_name.starts_with('.') {
            return true;
        }

        // Skip known system directories
        let skip_dirs = ["proc", "sys", "dev", "run", "snap"];
        if skip_dirs.contains(&file_name) {
            return true;
        }
    }

    false
}
```

### Rust Dependencies for Cross-Platform Support

```toml
# endpoint-agent/Cargo.toml

[dependencies]
# WASM Runtime
wasmtime = { version = "39", features = ["component-model", "component-model-async"] }
wasmtime-wasi = "39"

# Async Runtime
tokio = { version = "1", features = ["full"] }

# File System
walkdir = "2.4"              # Directory traversal
glob = "0.3"                 # Glob pattern matching
dirs = "5.0"                 # Platform-specific directories (home, config, etc.)
encoding_rs = "0.8"          # Character encoding detection
encoding_rs_io = "0.1"       # Streaming encoding

# Document Parsing (for text extraction)
pdf-extract = "0.7"          # PDF text extraction
calamine = "0.24"            # Excel (.xls, .xlsx) reading
docx-rs = "0.4"              # Word (.docx) reading
zip = "0.6"                  # ZIP archive handling

# HTTP Server (for receiving scan requests)
axum = { version = "0.7", features = ["macros"] }
tower = "0.4"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.52", features = ["Win32_Storage_FileSystem", "Win32_Foundation"] }

[target.'cfg(unix)'.dependencies]
nix = { version = "0.27", features = ["fs"] }
```

### Extension Deployment to Endpoint Agents

Extensions are deployed to endpoint agents via the existing bundle distribution system:

**Deployment Flow**:
```
1. Extension bundle published to object storage (S3/MinIO)
   └── sha256:<content_hash>/
       ├── manifest.json
       ├── entry.wasm (PII Scanner WASM component)
       └── precompiled/<target>.cwasm (optional)

2. Tenant installs extension via UI
   └── Creates tenant_extension_install record
       └── Links extension_id to content_hash

3. Server triggers scan job
   └── Job handler looks up install config
       └── Sends execute request to endpoint agent

4. Endpoint agent receives request
   ├── Checks local cache for content_hash
   ├── If miss: fetches bundle from object storage
   ├── Verifies signature and hash
   └── Loads WASM component into runtime

5. Subsequent scans use cached bundle
   └── Cache invalidated on version_id change
```

**Agent Bundle Cache**:
```rust
// endpoint-agent/src/cache/mod.rs

use std::path::PathBuf;

/// Platform-specific cache directory
pub fn get_cache_dir() -> PathBuf {
    #[cfg(windows)]
    {
        // C:\ProgramData\AlgaAgent\cache
        PathBuf::from(r"C:\ProgramData\AlgaAgent\cache")
    }

    #[cfg(target_os = "macos")]
    {
        // /Library/Application Support/AlgaAgent/cache
        PathBuf::from("/Library/Application Support/AlgaAgent/cache")
    }

    #[cfg(target_os = "linux")]
    {
        // /var/lib/alga-agent/cache
        PathBuf::from("/var/lib/alga-agent/cache")
    }
}

/// Cache structure
/// <cache_dir>/
///   └── extensions/
///       └── <content_hash>/
///           ├── manifest.json
///           ├── entry.wasm
///           └── entry.cwasm (precompiled)
```

### Endpoint Agent Installation

**Windows** (MSI Installer):
- Installs to `C:\Program Files\AlgaAgent\`
- Runs as Windows Service (`AlgaAgentService`)
- Registers with Alga PSA server on startup

**macOS** (PKG Installer):
- Installs to `/Library/AlgaAgent/`
- Runs as LaunchDaemon (`com.algapsa.agent`)
- Code-signed and notarized for Gatekeeper

**Linux** (DEB/RPM):
- Installs to `/opt/alga-agent/`
- Runs as systemd service (`alga-agent.service`)
- Supports both x86_64 and aarch64

**Agent Registration**:
```rust
// endpoint-agent/src/registration.rs

#[derive(Serialize)]
struct AgentRegistration {
    agent_id: Uuid,
    hostname: String,
    os: String,           // "windows", "macos", "linux"
    os_version: String,   // "10.0.19045", "14.2", "Ubuntu 22.04"
    arch: String,         // "x86_64", "aarch64"
    agent_version: String,
    capabilities: Vec<String>,  // ["pii_scan", "asm_scan", ...]
}

async fn register_agent(server_url: &str, tenant_id: &str) -> Result<AgentConfig> {
    let registration = AgentRegistration {
        agent_id: get_or_create_agent_id(),
        hostname: hostname::get()?.to_string_lossy().into(),
        os: std::env::consts::OS.to_string(),
        os_version: get_os_version(),
        arch: std::env::consts::ARCH.to_string(),
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
        capabilities: vec!["pii_scan".to_string()],
    };

    let response = reqwest::Client::new()
        .post(format!("{}/api/agents/register", server_url))
        .header("X-Tenant-ID", tenant_id)
        .json(&registration)
        .send()
        .await?;

    response.json().await
}
```

### Security Considerations

**Sandboxing**:
- WASM extensions run in Wasmtime sandbox with limited capabilities
- File system access restricted to explicitly granted paths
- No network access from WASM (only host can make HTTP calls)
- Memory limits enforced (default 512 MB)
- Execution time limits via epoch interruption

**Permission Model**:
```rust
// Capabilities granted to PII Scanner extension
const PII_SCANNER_CAPS: &[&str] = &[
    "cap:fs.read",        // Read file contents
    "cap:fs.walk",        // Walk directory trees
    "cap:fs.metadata",    // Get file metadata
    "cap:context.read",   // Read execution context
    "cap:log.emit",       // Emit log messages
];

// Capabilities NOT granted (denied by default)
// - cap:fs.write        // Cannot modify files
// - cap:fs.delete       // Cannot delete files
// - cap:http.fetch      // Cannot make network requests
// - cap:process.exec    // Cannot execute processes
```

**Data Privacy**:
- PII values are NEVER extracted or transmitted
- Only metadata (file path, line numbers, PII type) sent to server
- All file processing happens locally in WASM sandbox
- Extension cannot exfiltrate data (no network capability)

---

## API Endpoints

### PII Scanner

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/guard/pii/profiles` | List all profiles |
| POST | `/api/guard/pii/profiles` | Create profile |
| GET | `/api/guard/pii/profiles/:id` | Get profile |
| PUT | `/api/guard/pii/profiles/:id` | Update profile |
| DELETE | `/api/guard/pii/profiles/:id` | Delete profile |
| POST | `/api/guard/pii/profiles/:id/scan` | Trigger scan |
| GET | `/api/guard/pii/jobs` | List jobs |
| GET | `/api/guard/pii/jobs/:id` | Get job details |
| GET | `/api/guard/pii/jobs/:id/logs` | Download job logs |
| GET | `/api/guard/pii/results` | List results (paginated) |
| GET | `/api/guard/pii/results/:id` | Get result detail |
| DELETE | `/api/guard/pii/results/:id` | Purge single result |
| POST | `/api/guard/pii/results/purge` | Bulk purge |
| DELETE | `/api/guard/pii/results` | Purge all (admin) |
| GET | `/api/guard/pii/dashboard` | Dashboard data |

### ASM

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/guard/asm/domains` | List domains |
| POST | `/api/guard/asm/domains` | Add domain |
| GET | `/api/guard/asm/domains/:id` | Get domain |
| PUT | `/api/guard/asm/domains/:id` | Update domain |
| DELETE | `/api/guard/asm/domains/:id` | Remove domain |
| POST | `/api/guard/asm/domains/:id/scan` | Trigger scan |
| GET | `/api/guard/asm/jobs` | List jobs |
| GET | `/api/guard/asm/jobs/:id` | Get job details |
| GET | `/api/guard/asm/domains/:id/results` | Get all results |
| GET | `/api/guard/asm/domains/:id/subdomains` | Get subdomains |
| GET | `/api/guard/asm/domains/:id/ips` | Get IPs |
| GET | `/api/guard/asm/domains/:id/ports` | Get open ports |
| GET | `/api/guard/asm/domains/:id/cves` | Get CVEs |
| GET | `/api/guard/asm/domains/:id/dns` | Get DNS records |
| GET | `/api/guard/asm/domains/:id/headers` | Get HTTP headers |
| GET | `/api/guard/asm/domains/:id/cloud-storage` | Get cloud storage |
| GET | `/api/guard/asm/scanner-ips` | Get scanner pod IPs |
| GET | `/api/guard/asm/dashboard` | Dashboard data |

### Security Score

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/guard/scores` | List all company scores |
| GET | `/api/guard/scores/:companyId` | Get company score |
| GET | `/api/guard/scores/:companyId/breakdown` | Get score breakdown |
| GET | `/api/guard/scores/:companyId/history` | Get score history |
| GET | `/api/guard/scores/:companyId/issues` | Get top issues |
| POST | `/api/guard/scores/:companyId/what-if` | What-if simulation |
| POST | `/api/guard/scores/:companyId/recalculate` | Force recalculation |

### Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/guard/schedules` | List schedules |
| POST | `/api/guard/schedules` | Create schedule |
| GET | `/api/guard/schedules/:id` | Get schedule |
| PUT | `/api/guard/schedules/:id` | Update schedule |
| DELETE | `/api/guard/schedules/:id` | Delete schedule |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/guard/reports` | Generate report |
| GET | `/api/guard/reports` | List report jobs |
| GET | `/api/guard/reports/:id` | Get report job status |
| GET | `/api/guard/reports/:id/download` | Download report |

---

## UX / UI Notes

### Navigation Structure
```
Alga Guard (sidebar section)
├── Security Scores (client scorecard list)
├── Dashboard (unified overview)
├── PII Scanner
│   ├── Dashboard
│   ├── Profiles
│   ├── Results
│   ├── Jobs
│   └── Reports
├── Attack Surface Mapper
│   ├── Dashboard
│   ├── Domains
│   ├── Results (per-domain detail)
│   ├── Scheduler
│   └── Reports
└── Reports
    └── Security Score Reports
```

### Key UI Patterns

1. **Profile Builder (PII)** — Multi-step form or single page with sections:
   - Basic info (name, description)
   - PII types (checkbox grid)
   - File extensions (default checked + optional)
   - Target selection (company/agent tree with checkboxes)
   - Path configuration (include/exclude with add/remove rows)

2. **Results Grid** — Consistent data table pattern with:
   - Sortable/filterable columns
   - Row click opens detail side panel
   - Bulk selection for purge operations
   - Export to CSV

3. **Detail Side Panel** — Slides in from right showing:
   - Full metadata for the finding
   - Related context (other findings in same file/asset)
   - Action buttons (purge, export)

4. **Dashboard Widgets** — Card-based layout with:
   - Summary stat cards (counts with trend indicators)
   - Pie/donut charts for categorical breakdowns
   - Bar charts for top-N lists
   - Recent activity feed

5. **Job Status** — List view showing:
   - Profile/domain name
   - Status badge (Queued, Running, Completed, Failed)
   - Progress indicator for running jobs
   - Start time, duration
   - Download logs action

### PII-Specific UI Notes

- **Never display actual PII values** — Only show file path, line number, PII type
- **Visual severity indicators** — Color code by PII sensitivity (SSN/CC = red, email = yellow)
- **Batch operations** — Allow selecting multiple results for bulk purge

### ASM-Specific UI Notes

- **Geolocation flags** — Show country flags next to discovered IPs
- **Port status colors** — Green for expected (443), Red for risky (telnet, FTP)
- **CVE severity badges** — Color-coded by CVSS score (Critical/High/Medium/Low)
- **Expandable sections** — DNS records, headers as collapsible JSON/table views

### Security Score UI Notes

- **Score Display** — Large, prominent score (0-100) with color-coded background:
  - 0-39: Red (Critical Risk)
  - 40-59: Orange (High Risk)
  - 60-79: Yellow (Moderate Risk)
  - 80-100: Green (Low Risk)
- **Score Gauge** — Visual gauge/speedometer showing current score position
- **Trend Indicator** — Arrow showing score change since last scan (↑ improving, ↓ declining)
- **Score Breakdown** — Horizontal stacked bar or pie showing contribution of each factor
- **Top Issues List** — Ranked list of items with highest negative impact on score
- **Historical Chart** — Line graph showing score over time (last 90 days / 12 months)
- **What-If Simulator** — "If you fix these 3 items, your score improves by X points"
- **Client-Facing Mode** — Simplified view suitable for screen-sharing with clients

---

## File Structure

```
server/src/
├── lib/
│   ├── actions/
│   │   └── guard/
│   │       ├── pii-actions.ts
│   │       ├── asm-actions.ts
│   │       ├── score-actions.ts
│   │       └── schedule-actions.ts
│   ├── auth/
│   │   └── permissions/
│   │       └── guard.ts
│   ├── jobs/
│   │   └── handlers/
│   │       └── guard/
│   │           ├── piiScanHandler.ts
│   │           ├── asmScanHandler.ts
│   │           ├── scoreRecalcHandler.ts
│   │           └── reportGenerationHandler.ts
│   ├── reports/
│   │   └── definitions/
│   │       └── guard/
│   │           ├── pii-report.ts
│   │           ├── asm-report.ts
│   │           └── score-report.ts
│   └── guard/
│       ├── pii/
│       │   ├── patterns.ts           # Regex patterns
│       │   ├── detector.ts           # Detection logic
│       │   └── fileProcessors.ts     # File type handlers
│       ├── asm/
│       │   ├── scanner.ts            # ASM orchestration
│       │   ├── subdomain.ts          # Subdomain discovery
│       │   ├── portScan.ts           # Port scanning
│       │   ├── cveCorrelation.ts     # CVE lookup
│       │   └── cloudStorage.ts       # Cloud storage detection
│       └── score/
│           ├── calculator.ts         # Score algorithm
│           ├── weights.ts            # Severity weights
│           └── whatIf.ts             # What-if simulation
├── services/
│   └── guardService.ts               # Core business logic
├── components/
│   └── guard/
│       ├── GuardDashboard.tsx
│       ├── pii/
│       │   ├── ProfileList.tsx
│       │   ├── ProfileForm.tsx
│       │   ├── ResultsTable.tsx
│       │   └── PiiDashboard.tsx
│       ├── asm/
│       │   ├── DomainList.tsx
│       │   ├── DomainForm.tsx
│       │   ├── ResultsView.tsx
│       │   └── AsmDashboard.tsx
│       └── score/
│           ├── ScoreCard.tsx
│           ├── ScoreGauge.tsx
│           ├── ScoreBreakdown.tsx
│           ├── TrendChart.tsx
│           ├── TopIssues.tsx
│           └── WhatIfSimulator.tsx
└── app/
    └── api/
        └── guard/
            ├── pii/
            │   ├── profiles/route.ts
            │   ├── jobs/route.ts
            │   └── results/route.ts
            ├── asm/
            │   ├── domains/route.ts
            │   ├── jobs/route.ts
            │   └── results/route.ts
            ├── scores/route.ts
            ├── schedules/route.ts
            └── reports/route.ts

server/migrations/
├── YYYYMMDDHHMMSS_create_guard_pii_tables.cjs
├── YYYYMMDDHHMMSS_create_guard_asm_tables.cjs
├── YYYYMMDDHHMMSS_create_guard_schedule_tables.cjs
├── YYYYMMDDHHMMSS_create_guard_score_tables.cjs
└── YYYYMMDDHHMMSS_create_guard_report_tables.cjs

ee/server/migrations/citus/
└── guard_tables_distribution.sql       # Citus distribution setup
```

---

## Rollout / Migration

### Phase 1: PII Scanner MVP
- Database schema (guard_pii_*)
- Profile CRUD APIs
- Agent message protocol
- Basic PII detection (regex only)
- Results display (no dashboard)
- Basic Word/Excel reporting

### Phase 2: PII Scanner Complete
- ML-based NER integration
- Dashboard with visualizations
- Scheduled scanning
- Full reporting suite
- Result purging

### Phase 3: Attack Surface Mapper MVP
- Database schema (guard_asm_*)
- Domain management
- Basic reconnaissance (subdomains, IPs, ports)
- DNS records retrieval
- Results display

### Phase 4: ASM Complete
- CVE correlation with NVD
- EPSS score integration
- Cloud storage discovery
- GeoIP integration
- Dashboard and reporting
- Customer-deployed scanner support

### Phase 5: Security Score
- Database schema (guard_security_scores, guard_security_score_history)
- Score calculation engine
- Score dashboard with gauge
- Historical tracking and trend charts
- Top issues identification
- What-if simulator
- Security Score reporting
- Portfolio comparison view

---

## Acceptance Criteria (Definition of Done)

### PII Scanner
- [ ] User can create, edit, delete scan profiles
- [ ] User can select PII types, extensions, targets, and paths
- [ ] User can trigger on-demand scan and view job progress
- [ ] Scan results show file location and line numbers without actual PII
- [ ] User can view PII dashboard with aggregate metrics
- [ ] User can generate and download PII reports
- [ ] User can purge scan results
- [ ] Scheduled scans execute automatically

### Attack Surface Mapper
- [ ] User can add, edit, remove domains
- [ ] Scan discovers subdomains, IPs, open ports, services
- [ ] Scan retrieves DNS records and HTTP headers
- [ ] Scan identifies associated CVEs with scores
- [ ] Scan discovers exposed cloud storage
- [ ] User can view ASM dashboard with domain summary
- [ ] User can generate and download ASM reports
- [ ] Scheduled scans execute automatically
- [ ] Scanning pod IPs are documented for whitelisting

### Security Score
- [ ] Each company has a calculated Security Score (0-100)
- [ ] Score recalculates automatically after PII or ASM scans complete
- [ ] Score breakdown shows contribution from each factor category
- [ ] Historical scores are stored and displayed as trend chart
- [ ] Top issues list identifies highest-impact findings
- [ ] What-if simulator shows projected score improvement
- [ ] Security Score Report can be generated for client delivery
- [ ] Score comparison view shows all companies in portfolio

### Integration
- [ ] Module respects Alga PSA tenant/company permissions
- [ ] Feature flag controls module visibility
- [ ] PII scans execute via existing agent infrastructure
- [ ] All features accessible from Alga PSA navigation
- [ ] Email notifications sent for critical findings
