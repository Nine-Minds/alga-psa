'use client';

import React from 'react';
import { Copy, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import type { DnsRecord, DnsLookupResult } from '@alga-psa/types';
import toast from 'react-hot-toast';

interface DnsRecordInstructionsProps {
  records: DnsRecord[];
  emptyMessage?: string;
  detections?: DnsLookupResult[];
  lastCheckedAt?: string | null;
}

type DetectionStatus = 'matched' | 'mismatch' | 'missing' | 'unknown';

const STATUS_STYLES: Record<
  DetectionStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  matched: {
    label: 'Detected',
    className: 'text-emerald-700 bg-emerald-50 border border-emerald-200',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  mismatch: {
    label: 'Mismatch',
    className: 'text-amber-700 bg-amber-50 border border-amber-200',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  missing: {
    label: 'Not Found',
    className: 'text-red-700 bg-red-50 border border-red-200',
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
  unknown: {
    label: 'Waiting for Check',
    className: 'text-gray-600 bg-gray-50 border border-gray-200',
    icon: <Clock className="h-3.5 w-3.5" />,
  },
};

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const buildRecordKey = (record: DnsRecord) =>
  `${record.type}:${record.name}:${record.value ?? ''}`.toLowerCase();

function getDetectionStatus(record: DnsRecord, detection?: DnsLookupResult): DetectionStatus {
  if (!detection) {
    return 'unknown';
  }
  if (detection.matchedValue) {
    return 'matched';
  }
  if (!detection.values || detection.values.length === 0 || detection.error === 'not_found') {
    return 'missing';
  }
  return 'mismatch';
}

const renderDetectedValues = (values: string[]) => {
  if (!values.length) {
    return null;
  }

  return (
    <div className="text-xs text-gray-600 space-y-1">
      <span className="font-medium text-gray-700">Detected values</span>
      <ul className="list-disc pl-5 space-y-1">
        {values.map((value, valueIndex) => (
          <li key={`${value}-${valueIndex}`}>
            <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">{value}</code>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default function DnsRecordInstructions({ records, emptyMessage, detections, lastCheckedAt }: DnsRecordInstructionsProps) {
  if (!records || records.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {emptyMessage ??
          'We are preparing the DNS records for this domain. As soon as they appear, copy them into your DNS provider because we cannot update it for you.'}
      </p>
    );
  }

  const detectionMap = new Map<string, DnsLookupResult>();
  (detections ?? []).forEach((result) => {
    const key = buildRecordKey(result.record);
    detectionMap.set(key, result);
  });

  const matchedCount = (detections ?? []).filter((entry) => entry.matchedValue).length;
  const totalTracked = records.length || detections?.length || 0;
  const lastCheckedReadable = formatTimestamp(lastCheckedAt);

  const handleCopy = (value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Failed to copy')
    );
  };

  return (
    <div className="space-y-3">
      {detections && detections.length > 0 ? (
        <div className="text-xs text-gray-600">
          Matched {matchedCount} of {totalTracked} required DNS records
          {lastCheckedReadable ? ` • Last checked ${lastCheckedReadable}` : ''}.
        </div>
      ) : lastCheckedReadable ? (
        <div className="text-xs text-gray-500">Last checked {lastCheckedReadable}. We have not detected any records yet.</div>
      ) : null}

      {records.map((record, index) => {
        const detection = detectionMap.get(buildRecordKey(record));
        const status = getDetectionStatus(record, detection);
        const statusStyle = STATUS_STYLES[status];

        return (
          <Card
            key={`${record.type}-${record.name}-${index}`}
            className="border border-gray-200"
            data-automation-id="managed-domain-dns-record"
            data-record-type={record.type}
            data-dns-status={status}
          >
            <CardContent className="py-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase text-gray-500">{record.type}</span>
                  <span className="text-sm text-gray-700">{record.name}</span>
                </div>
              <Button
                id={`managed-domain-dns-copy-${record.type}-${index}`}
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

            <div className="flex flex-wrap gap-2 items-center">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle.className}`}
                data-automation-id="managed-domain-dns-status"
                data-status={status}
              >
                {statusStyle.icon}
                {statusStyle.label}
              </span>
              {detection?.checkedAt ? (
                <span className="text-[11px] text-gray-500">
                  Checked {formatTimestamp(detection.checkedAt) ?? detection.checkedAt}
                </span>
              ) : null}
            </div>

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

            {status === 'missing' ? (
              <div className="text-xs text-red-600">
                We have not detected this record in DNS yet. Double-check that it exists in your DNS provider with the exact value
                shown above.
              </div>
            ) : null}

            {status === 'mismatch' && detection ? (
              <div className="text-xs text-amber-700 space-y-1">
                <p>The DNS record exists, but the value does not match what Resend expects.</p>
                {renderDetectedValues(detection.values)}
              </div>
            ) : null}

            {status === 'matched' && detection ? (
              <div className="text-xs text-emerald-700 space-y-1">
                <p>Detected value matches what we expected.</p>
                {renderDetectedValues(detection.values)}
              </div>
            ) : null}

              {status === 'unknown' && !detections?.length ? (
                <div className="text-xs text-gray-500">We have not checked DNS yet. Re-check DNS to run verification.</div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
