'use client';

import React from 'react';
import { Copy } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { Card, CardContent } from 'server/src/components/ui/Card';
import { Label } from 'server/src/components/ui/Label';
import type { DnsRecord } from 'server/src/types/email.types';
import toast from 'react-hot-toast';

interface DnsRecordInstructionsProps {
  records: DnsRecord[];
  emptyMessage?: string;
}

export default function DnsRecordInstructions({ records, emptyMessage }: DnsRecordInstructionsProps) {
  if (!records || records.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {emptyMessage ?? 'DNS records will appear here once the provider generates them.'}
      </p>
    );
  }

  const handleCopy = (value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Failed to copy')
    );
  };

  return (
    <div className="space-y-3">
      {records.map((record, index) => (
        <Card
          key={`${record.type}-${record.name}-${index}`}
          className="border border-gray-200"
          data-automation-id="managed-domain-dns-record"
          data-record-type={record.type}
        >
          <CardContent className="py-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase text-gray-500">{record.type}</span>
                <span className="text-sm text-gray-700">{record.name}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(record.value)}
                aria-label="Copy DNS value"
                data-automation-id="managed-domain-copy-dns"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>

            <div className="text-sm text-gray-800 break-all">{record.value}</div>

            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              {record.ttl ? (
                <span>
                  <Label className="text-gray-500">TTL:</Label> {record.ttl}
                </span>
              ) : null}
              {record.priority ? (
                <span>
                  <Label className="text-gray-500">Priority:</Label> {record.priority}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
