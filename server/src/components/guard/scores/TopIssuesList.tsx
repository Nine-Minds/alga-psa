'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { AlertTriangle, Shield, Server, Cloud, Mail, FileWarning } from 'lucide-react';

interface Issue {
  id: string;
  type: 'pii' | 'cve' | 'port' | 'cloud' | 'email';
  description: string;
  impact: number;
  details?: string;
  remediation?: string;
}

interface TopIssuesListProps {
  issues: Issue[];
  maxDisplay?: number;
}

// Issue type configuration
const issueTypeConfig: Record<string, {
  label: string;
  icon: React.ReactNode;
  bgColor: string;
  textColor: string;
}> = {
  pii: {
    label: 'PII Exposure',
    icon: <FileWarning className="w-4 h-4" />,
    bgColor: 'bg-red-100 dark:bg-red-950/30',
    textColor: 'text-red-700 dark:text-red-400',
  },
  cve: {
    label: 'Vulnerability',
    icon: <AlertTriangle className="w-4 h-4" />,
    bgColor: 'bg-orange-100 dark:bg-orange-950/30',
    textColor: 'text-orange-700 dark:text-orange-400',
  },
  port: {
    label: 'Open Port',
    icon: <Server className="w-4 h-4" />,
    bgColor: 'bg-yellow-100 dark:bg-yellow-950/30',
    textColor: 'text-yellow-700 dark:text-yellow-400',
  },
  cloud: {
    label: 'Cloud Storage',
    icon: <Cloud className="w-4 h-4" />,
    bgColor: 'bg-blue-100 dark:bg-blue-950/30',
    textColor: 'text-blue-700 dark:text-blue-400',
  },
  email: {
    label: 'Email Security',
    icon: <Mail className="w-4 h-4" />,
    bgColor: 'bg-purple-100 dark:bg-purple-950/30',
    textColor: 'text-purple-700 dark:text-purple-400',
  },
};

export default function TopIssuesList({ issues, maxDisplay = 10 }: TopIssuesListProps) {
  // Sort by impact (highest first) and limit
  const sortedIssues = [...issues]
    .sort((a, b) => b.impact - a.impact)
    .slice(0, maxDisplay);

  const totalImpact = sortedIssues.reduce((sum, i) => sum + i.impact, 0);

  if (issues.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            Top Issues
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Shield className="w-12 h-12 mx-auto text-green-500 mb-2" />
            <p className="text-green-600 font-medium">Excellent!</p>
            <p className="text-sm text-muted-foreground">No significant security issues detected</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          Top Issues by Score Impact
        </CardTitle>
        <CardDescription>
          Addressing these issues would improve the score by up to {totalImpact} points
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sortedIssues.map((issue, index) => {
            const config = issueTypeConfig[issue.type] || issueTypeConfig.pii;
            const impactPercent = (issue.impact / totalImpact) * 100;

            return (
              <div
                key={issue.id}
                className={`p-3 rounded-lg border ${config.bgColor}`}
              >
                <div className="flex items-start gap-3">
                  {/* Rank */}
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {index + 1}
                  </div>

                  {/* Icon */}
                  <div className={`flex-shrink-0 mt-0.5 ${config.textColor}`}>
                    {config.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${config.textColor} bg-white/50`}>
                        {config.label}
                      </span>
                      <span className="text-sm font-bold text-red-600">
                        -{issue.impact} pts
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{issue.description}</p>
                    {issue.details && (
                      <p className="mt-1 text-xs text-muted-foreground">{issue.details}</p>
                    )}
                    {issue.remediation && (
                      <p className="mt-2 text-xs text-green-700 dark:text-green-400">
                        💡 <strong>Fix:</strong> {issue.remediation}
                      </p>
                    )}
                  </div>
                </div>

                {/* Impact bar */}
                <div className="mt-2 ml-9">
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500 rounded-full transition-all"
                      style={{ width: `${impactPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {issues.length > maxDisplay && (
          <div className="mt-4 text-center">
            <p className="text-sm text-muted-foreground">
              Showing top {maxDisplay} of {issues.length} issues
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
