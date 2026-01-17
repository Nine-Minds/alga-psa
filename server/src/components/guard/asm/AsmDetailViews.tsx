'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Server,
  Radio,
  Cloud,
  FileText,
  Shield,
  AlertTriangle,
  Copy
} from 'lucide-react';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

// Subdomain types
interface Subdomain {
  id: string;
  subdomain: string;
  ip_addresses: string[];
  discovered_via: string;
  first_seen: string;
  last_seen: string;
}

// IP Address types
interface IpAddress {
  id: string;
  ip: string;
  version: 'v4' | 'v6';
  country_code?: string;
  country_name?: string;
  city?: string;
  asn?: string;
  org?: string;
  first_seen: string;
}

// Open Port types
interface OpenPort {
  id: string;
  ip: string;
  port: number;
  protocol: 'tcp' | 'udp';
  service?: string;
  version?: string;
  risk_level: 'critical' | 'high' | 'medium' | 'low' | 'info';
  first_seen: string;
}

// Cloud Storage types
interface CloudStorage {
  id: string;
  bucket_type: 's3' | 'azure' | 'gcs';
  bucket_name: string;
  url: string;
  is_public: boolean;
  discovered_via: string;
  first_seen: string;
}

// DNS Record types
interface DnsRecord {
  record_type: string;
  name: string;
  value: string;
  ttl?: number;
}

// HTTP Header types
interface HttpHeader {
  header_name: string;
  expected: boolean;
  present: boolean;
  value?: string;
  recommendation?: string;
}

// Country flag component
const CountryFlag: React.FC<{ code?: string; name?: string }> = ({ code, name }) => {
  if (!code) return <span className="text-muted-foreground">Unknown</span>;

  // Convert country code to flag emoji
  const getFlagEmoji = (countryCode: string) => {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-lg">{getFlagEmoji(code)}</span>
      <span>{name || code}</span>
    </span>
  );
};

// Risk badge component
const RiskBadge: React.FC<{ level: string }> = ({ level }) => {
  const config: Record<string, string> = {
    critical: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-blue-100 text-blue-800',
    info: 'bg-gray-100 text-gray-800',
  };
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config[level] || config.info}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
};

// Collapsible section
const CollapsibleSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, icon, count, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{icon}</span>
          <span className="font-medium">{title}</span>
          {count !== undefined && (
            <span className="px-2 py-0.5 text-xs bg-muted rounded-full">{count}</span>
          )}
        </div>
        {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>
      {isOpen && <div className="p-4 pt-0 border-t">{children}</div>}
    </div>
  );
};

// Subdomains List View (F227)
export function SubdomainsList({ subdomains }: { subdomains: Subdomain[] }) {
  const columns: ColumnDefinition<Subdomain>[] = [
    { title: 'Subdomain', dataIndex: 'subdomain', render: (value) => (
      <span className="font-mono text-sm">{value as string}</span>
    )},
    { title: 'IP Addresses', dataIndex: 'ip_addresses', render: (value) => (
      <div className="space-y-1">
        {(value as string[]).map((ip, i) => (
          <span key={i} className="block font-mono text-xs">{ip}</span>
        ))}
      </div>
    )},
    { title: 'Discovered Via', dataIndex: 'discovered_via' },
    { title: 'First Seen', dataIndex: 'first_seen', render: (value) => new Date(value as string).toLocaleDateString() },
  ];

  return (
    <CollapsibleSection title="Subdomains" icon={<Globe className="w-5 h-5" />} count={subdomains.length}>
      {subdomains.length === 0 ? (
        <p className="text-muted-foreground text-sm">No subdomains discovered</p>
      ) : (
        <DataTable columns={columns} data={subdomains} />
      )}
    </CollapsibleSection>
  );
}

// IP Addresses List with Geolocation (F228)
export function IpAddressesList({ addresses }: { addresses: IpAddress[] }) {
  const columns: ColumnDefinition<IpAddress>[] = [
    { title: 'IP Address', dataIndex: 'ip', render: (value, record) => (
      <span className="font-mono text-sm">
        {value as string}
        <span className="ml-2 text-xs text-muted-foreground">({record.version})</span>
      </span>
    )},
    { title: 'Location', dataIndex: 'country_code', render: (value, record) => (
      <CountryFlag code={value as string} name={record.country_name} />
    )},
    { title: 'City', dataIndex: 'city' },
    { title: 'Organization', dataIndex: 'org', render: (value) => (
      <span className="text-sm truncate max-w-[200px] block">{value as string || '-'}</span>
    )},
    { title: 'ASN', dataIndex: 'asn', render: (value) => (
      <span className="font-mono text-xs">{value as string || '-'}</span>
    )},
  ];

  return (
    <CollapsibleSection title="IP Addresses" icon={<Server className="w-5 h-5" />} count={addresses.length}>
      {addresses.length === 0 ? (
        <p className="text-muted-foreground text-sm">No IP addresses discovered</p>
      ) : (
        <DataTable columns={columns} data={addresses} />
      )}
    </CollapsibleSection>
  );
}

// Open Ports List with Risk Colors (F229)
export function OpenPortsList({ ports }: { ports: OpenPort[] }) {
  const columns: ColumnDefinition<OpenPort>[] = [
    { title: 'IP:Port', dataIndex: 'port', render: (value, record) => (
      <span className="font-mono text-sm">{record.ip}:{value}</span>
    )},
    { title: 'Protocol', dataIndex: 'protocol', render: (value) => (
      <span className="uppercase text-xs font-medium">{value as string}</span>
    )},
    { title: 'Service', dataIndex: 'service', render: (value, record) => (
      <div>
        <span className="font-medium">{value as string || 'Unknown'}</span>
        {record.version && (
          <span className="ml-2 text-xs text-muted-foreground">{record.version}</span>
        )}
      </div>
    )},
    { title: 'Risk', dataIndex: 'risk_level', render: (value) => <RiskBadge level={value as string} /> },
    { title: 'First Seen', dataIndex: 'first_seen', render: (value) => new Date(value as string).toLocaleDateString() },
  ];

  return (
    <CollapsibleSection title="Open Ports" icon={<Radio className="w-5 h-5" />} count={ports.length}>
      {ports.length === 0 ? (
        <p className="text-muted-foreground text-sm">No open ports discovered</p>
      ) : (
        <DataTable columns={columns} data={ports} />
      )}
    </CollapsibleSection>
  );
}

// Cloud Storage Findings (F230)
export function CloudStorageList({ buckets }: { buckets: CloudStorage[] }) {
  const getBucketIcon = (type: string) => {
    switch (type) {
      case 's3': return 'S3';
      case 'azure': return 'Azure';
      case 'gcs': return 'GCS';
      default: return 'Cloud';
    }
  };

  const columns: ColumnDefinition<CloudStorage>[] = [
    { title: 'Type', dataIndex: 'bucket_type', render: (value) => (
      <span className="px-2 py-1 bg-muted rounded text-xs font-medium">{getBucketIcon(value as string)}</span>
    )},
    { title: 'Bucket Name', dataIndex: 'bucket_name', render: (value) => (
      <span className="font-mono text-sm">{value as string}</span>
    )},
    { title: 'Access', dataIndex: 'is_public', render: (value) => (
      value ? (
        <span className="inline-flex items-center gap-1 text-red-600">
          <AlertTriangle className="w-4 h-4" />
          Public
        </span>
      ) : (
        <span className="text-green-600">Private</span>
      )
    )},
    { title: 'URL', dataIndex: 'url', render: (value) => (
      <a href={value as string} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate max-w-[200px] block">
        {value as string}
      </a>
    )},
  ];

  return (
    <CollapsibleSection title="Cloud Storage" icon={<Cloud className="w-5 h-5" />} count={buckets.length}>
      {buckets.length === 0 ? (
        <p className="text-muted-foreground text-sm">No cloud storage buckets discovered</p>
      ) : (
        <DataTable columns={columns} data={buckets} />
      )}
    </CollapsibleSection>
  );
}

// DNS Records Collapsible View (F231)
export function DnsRecordsView({ records }: { records: DnsRecord[] }) {
  const groupedRecords = records.reduce((acc, record) => {
    if (!acc[record.record_type]) acc[record.record_type] = [];
    acc[record.record_type].push(record);
    return acc;
  }, {} as Record<string, DnsRecord[]>);

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
  };

  return (
    <CollapsibleSection title="DNS Records" icon={<FileText className="w-5 h-5" />} count={records.length}>
      {records.length === 0 ? (
        <p className="text-muted-foreground text-sm">No DNS records found</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedRecords).map(([type, recs]) => (
            <div key={type}>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">{type}</span>
                <span className="text-muted-foreground">({recs.length})</span>
              </h4>
              <div className="space-y-1">
                {recs.map((rec, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                    <div className="flex-1">
                      <span className="font-mono">{rec.name}</span>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <span className="font-mono">{rec.value}</span>
                      {rec.ttl && <span className="ml-2 text-xs text-muted-foreground">TTL: {rec.ttl}</span>}
                    </div>
                    <Button id={`copy-dns-${type}-${i}`} variant="ghost" size="sm" onClick={() => handleCopy(rec.value)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

// HTTP Headers Collapsible View (F232)
export function HttpHeadersView({ headers }: { headers: HttpHeader[] }) {
  const securityHeaders = headers.filter(h => h.expected);
  const presentCount = securityHeaders.filter(h => h.present).length;

  return (
    <CollapsibleSection
      title="HTTP Security Headers"
      icon={<Shield className="w-5 h-5" />}
      count={securityHeaders.length}
    >
      {headers.length === 0 ? (
        <p className="text-muted-foreground text-sm">No header analysis available</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-green-600">{presentCount} present</span>
            <span className="text-red-600">{securityHeaders.length - presentCount} missing</span>
          </div>
          <div className="space-y-2">
            {headers.map((header, i) => (
              <div key={i} className={`p-3 rounded-lg border ${header.present ? 'bg-green-50 border-green-200 dark:bg-green-950/20' : 'bg-red-50 border-red-200 dark:bg-red-950/20'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {header.present ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-red-600">✗</span>
                    )}
                    <span className="font-medium">{header.header_name}</span>
                  </div>
                  {header.expected && !header.present && (
                    <span className="text-xs text-red-600">Missing - Recommended</span>
                  )}
                </div>
                {header.value && (
                  <div className="mt-1 text-xs font-mono text-muted-foreground truncate">
                    {header.value}
                  </div>
                )}
                {header.recommendation && !header.present && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    💡 {header.recommendation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

// Scanner Pod IPs Display (F239)
export function ScannerPodIpsDisplay({ podIps }: { podIps: string[] }) {
  const handleCopyAll = () => {
    navigator.clipboard.writeText(podIps.join('\n'));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="w-5 h-5" />
          Scanner Pod IPs
        </CardTitle>
        <Button id="copy-all-ips-btn" variant="outline" size="sm" onClick={handleCopyAll}>
          <Copy className="w-4 h-4 mr-2" />
          Copy All
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Whitelist these IPs in your client firewalls for ASM scanning:
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {podIps.map((ip, i) => (
            <div key={i} className="font-mono text-sm bg-muted px-3 py-2 rounded">
              {ip}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
