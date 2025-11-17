'use client';

import React from 'react';
import { RefreshCw, Trash2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import DnsRecordInstructions from './DnsRecordInstructions';
import type { ManagedDomainStatus } from '@ee/lib/actions/email-actions/managedDomainActions';

interface ManagedDomainListProps {
  domains: ManagedDomainStatus[];
  loading?: boolean;
  busyDomain?: string | null;
  onRefresh: (domain: string) => void | Promise<void>;
  onDelete: (domain: string) => void | Promise<void>;
}

const STATUS_BADGE_STYLES: Record<
  string,
  {
    icon: React.ReactNode;
    className: string;
  }
> = {
  verified: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    className: 'bg-primary-100 text-primary-900 border border-primary-200',
  },
  failed: {
    icon: <AlertTriangle className="h-4 w-4" />,
    className: 'bg-destructive/10 text-destructive border border-destructive/40',
  },
  pending: {
    icon: <Clock className="h-4 w-4" />,
    className: 'bg-accent-100 text-accent-900 border border-accent-200',
  },
};

const DNS_RECORDS_HELP_TEXT =
  'Copy each record below into your DNS provider (GoDaddy, Cloudflare, etc.). We cannot change your DNS for you.';

function getDnsEmptyMessage(status?: string) {
  const normalized = status?.toLowerCase();

  if (normalized === 'pending') {
    return 'We asked Resend to generate the DNS records for this domain. Once they show up, copy them into your DNS provider because we cannot update it automatically.';
  }

  if (normalized === 'failed') {
    return 'We still need DNS instructions from Resend. Click Re-check DNS and, when the records load, publish them inside your DNS provider.';
  }

  return 'DNS instructions are not available yet. Re-check DNS and copy each record into your DNS provider as soon as it appears.';
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status?.toLowerCase();
  const config =
    STATUS_BADGE_STYLES[normalized ?? ''] ??
    ({
      icon: <Clock className="h-4 w-4" />,
      className: 'bg-secondary-100 text-secondary-800 border border-secondary-200',
    } as const);

  return (
    <Badge className={`gap-1 ${config.className}`} data-automation-id="managed-domain-status">
      {config.icon}
      {status}
    </Badge>
  );
}

export default function ManagedDomainList({
  domains,
  loading,
  busyDomain,
  onRefresh,
  onDelete,
}: ManagedDomainListProps) {
  if (loading) {
    return <p className="text-sm text-gray-500">Loading domains…</p>;
  }

  if (!domains || domains.length === 0) {
    return <p className="text-sm text-gray-500">No managed domains yet. Add one to get started.</p>;
  }

  return (
    <div className="space-y-4">
      {domains.map((domain) => {
        const normalizedStatus = domain.status?.toLowerCase();
        const showRetry = normalizedStatus === 'pending' || normalizedStatus === 'failed';
        const showDelete = normalizedStatus !== 'verified' || Boolean(domain.failureReason);
        const dnsRecords = domain.dnsRecords ?? [];
        const dnsLookupResults = domain.dnsLookupResults ?? [];
        const hasRecords = dnsRecords.length > 0;
        const emptyMessage = getDnsEmptyMessage(normalizedStatus);

        return (
          <Card
            key={domain.domain}
            className="border border-gray-200"
            data-automation-id="managed-domain-card"
            data-domain={domain.domain}
          >
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">{domain.domain}</CardTitle>
                  <CardDescription>
                    {domain.providerDomainId ? `Provider domain ID: ${domain.providerDomainId}` : 'Managed via Resend'}
                  </CardDescription>
                </div>
                <StatusBadge status={domain.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {domain.failureReason ? (
                <p className="text-sm text-red-600">Failure reason: {domain.failureReason}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {showRetry ? (
                  <Button
                    id={`managed-domain-${domain.domain}-refresh-button`}
                    size="sm"
                    variant="outline"
                    disabled={busyDomain === domain.domain}
                    onClick={() => onRefresh(domain.domain)}
                    data-automation-id="managed-domain-refresh"
                    data-domain={domain.domain}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Re-check DNS
                  </Button>
                ) : null}
                {showDelete ? (
                  <Button
                    id={`managed-domain-${domain.domain}-remove-button`}
                    size="sm"
                    variant="ghost"
                    disabled={busyDomain === domain.domain}
                    onClick={() => onDelete(domain.domain)}
                    data-automation-id="managed-domain-remove"
                    data-domain={domain.domain}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                ) : null}
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">DNS Records</p>
                {hasRecords ? <p className="text-xs text-gray-500 mb-3">{DNS_RECORDS_HELP_TEXT}</p> : null}
                <DnsRecordInstructions
                  records={dnsRecords}
                  emptyMessage={emptyMessage}
                  detections={dnsLookupResults}
                  lastCheckedAt={domain.dnsLastCheckedAt}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
