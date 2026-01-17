'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import {
  X,
  FileText,
  MapPin,
  Clock,
  AlertTriangle,
  Trash2,
  Copy
} from 'lucide-react';

interface PiiResultDetailProps {
  result: {
    id: string;
    pii_type: string;
    file_path: string;
    line_numbers?: number[];
    confidence_score: number;
    found_at: string;
    job_id: string;
    agent_id?: string;
    agent_name?: string;
    company_id?: string;
    company_name?: string;
    context_preview?: string;
  };
  onClose: () => void;
  onPurge?: (resultId: string) => void;
}

// Severity badge
const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  const config: Record<string, { className: string; label: string }> = {
    critical: { className: 'bg-red-100 text-red-800', label: 'Critical' },
    high: { className: 'bg-orange-100 text-orange-800', label: 'High' },
    medium: { className: 'bg-yellow-100 text-yellow-800', label: 'Medium' },
    low: { className: 'bg-blue-100 text-blue-800', label: 'Low' },
  };
  const { className, label } = config[severity] || config.low;
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${className}`}>
      {label} Severity
    </span>
  );
};

// PII type display names
const PII_TYPE_LABELS: Record<string, string> = {
  ssn: 'Social Security Number',
  credit_card: 'Credit Card Number',
  bank_account: 'Bank Account Number',
  passport: 'Passport Number',
  drivers_license: "Driver's License",
  dob: 'Date of Birth',
  phone: 'Phone Number',
  email: 'Email Address',
  ip_address: 'IP Address',
  mac_address: 'MAC Address',
};

// Get severity from PII type
const getSeverity = (piiType: string): string => {
  const severityMap: Record<string, string> = {
    ssn: 'critical',
    credit_card: 'critical',
    bank_account: 'high',
    passport: 'high',
    drivers_license: 'high',
    dob: 'medium',
    phone: 'medium',
    email: 'low',
    ip_address: 'low',
    mac_address: 'low',
  };
  return severityMap[piiType] || 'low';
};

export default function PiiResultDetail({ result, onClose, onPurge }: PiiResultDetailProps) {
  const severity = getSeverity(result.pii_type);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(result.file_path);
  };

  const handlePurge = () => {
    if (confirm('Are you sure you want to purge this finding? This action cannot be undone.')) {
      onPurge?.(result.id);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-background shadow-xl border-l z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Finding Details</h2>
        <Button id="close-detail-btn" variant="ghost" size="sm" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Severity and Type */}
        <div className="flex items-center justify-between">
          <SeverityBadge severity={severity} />
          <span className="text-sm text-muted-foreground">
            ID: {result.id.slice(0, 8)}...
          </span>
        </div>

        {/* PII Type */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              PII Type Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">
              {PII_TYPE_LABELS[result.pii_type] || result.pii_type}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Confidence: {Math.round(result.confidence_score * 100)}%
            </div>
          </CardContent>
        </Card>

        {/* File Location */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              File Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-2">
              <code className="flex-1 text-sm bg-muted p-2 rounded break-all">
                {result.file_path}
              </code>
              <Button id="copy-path-btn" variant="ghost" size="sm" onClick={handleCopyPath} title="Copy path">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            {result.line_numbers && result.line_numbers.length > 0 && (
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">Lines: </span>
                <span className="font-mono">{result.line_numbers.join(', ')}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Context Preview (redacted) */}
        {result.context_preview && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Context (Redacted)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                {result.context_preview}
              </pre>
              <p className="text-xs text-muted-foreground mt-2 italic">
                Actual PII values are not stored or displayed
              </p>
            </CardContent>
          </Card>
        )}

        {/* Source Information */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Source
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.company_name && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Company:</span>
                <span>{result.company_name}</span>
              </div>
            )}
            {result.agent_name && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Agent:</span>
                <span>{result.agent_name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Job ID:</span>
              <span className="font-mono text-xs">{result.job_id.slice(0, 12)}...</span>
            </div>
          </CardContent>
        </Card>

        {/* Timestamp */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Discovery Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {new Date(result.found_at).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {new Date(result.found_at).toISOString()}
            </div>
          </CardContent>
        </Card>

        {/* Remediation Guidance */}
        <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Remediation Guidance
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-amber-700 dark:text-amber-300">
            {severity === 'critical' && (
              <p>
                <strong>Immediate action required.</strong> This file contains highly sensitive PII
                that could lead to identity theft or financial fraud if exposed. Review and secure
                or delete this file immediately.
              </p>
            )}
            {severity === 'high' && (
              <p>
                <strong>Action recommended.</strong> This file contains sensitive personal information.
                Consider encrypting, moving to a secure location, or deleting if not needed.
              </p>
            )}
            {severity === 'medium' && (
              <p>
                Review this file to determine if the PII needs to be retained. If not required for
                business purposes, consider removal or redaction.
              </p>
            )}
            {severity === 'low' && (
              <p>
                This finding represents lower-risk PII. Review for compliance requirements and
                determine if retention is necessary.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t bg-muted/50 flex justify-between">
        <Button
          id="purge-finding-btn"
          variant="outline"
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={handlePurge}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Purge Finding
        </Button>
        <Button id="close-detail-footer-btn" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
