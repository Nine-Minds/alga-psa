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

const statusIcon: Record<string, React.ReactNode> = {
  verified: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  failed: <AlertTriangle className="h-4 w-4 text-red-600" />,
  pending: <Clock className="h-4 w-4 text-amber-500" />,
};

function StatusBadge({ status }: { status: string }) {
  const normalized = status?.toLowerCase();
  let variant: 'default' | 'secondary' | 'destructive' = 'secondary';

  if (normalized === 'verified') {
    variant = 'default';
  } else if (normalized === 'failed') {
    variant = 'destructive';
  }

  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {statusIcon[normalized ?? 'pending']}
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

        return (
          <Card key={domain.domain} className="border border-gray-200">
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
                    size="sm"
                    variant="outline"
                    disabled={busyDomain === domain.domain}
                    onClick={() => onRefresh(domain.domain)}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Re-check DNS
                  </Button>
                ) : null}
                {showDelete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyDomain === domain.domain}
                    onClick={() => onDelete(domain.domain)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                ) : null}
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">DNS Records</p>
                <DnsRecordInstructions records={domain.dnsRecords || []} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
