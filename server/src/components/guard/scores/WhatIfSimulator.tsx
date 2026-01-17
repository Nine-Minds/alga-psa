'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import {
  Lightbulb,
  TrendingUp,
  Check,
  RefreshCw,
  ChevronRight
} from 'lucide-react';

interface Issue {
  id: string;
  type: 'pii' | 'cve' | 'port' | 'cloud' | 'email';
  description: string;
  impact: number;
  remediation?: string;
}

interface WhatIfSimulatorProps {
  currentScore: number;
  topIssues: Issue[];
  onSimulate?: (removedIssueIds: string[]) => Promise<{ projected_score: number }>;
}

// Score gauge visualization
const ScoreGauge: React.FC<{ score: number; label: string; size?: 'sm' | 'lg' }> = ({ score, label, size = 'lg' }) => {
  const sizeConfig = {
    sm: { width: 80, height: 80, strokeWidth: 6, fontSize: 'text-lg' },
    lg: { width: 120, height: 120, strokeWidth: 8, fontSize: 'text-2xl' },
  };

  const { width, height, strokeWidth, fontSize } = sizeConfig[size];
  const radius = (width - strokeWidth) / 2;
  const circumference = radius * Math.PI * 2;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return '#22c55e';
    if (s >= 60) return '#eab308';
    if (s >= 40) return '#f97316';
    return '#ef4444';
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={width} height={height} className="-rotate-90">
          <circle
            cx={width / 2}
            cy={height / 2}
            r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={width / 2}
            cy={height / 2}
            r={radius}
            fill="none"
            stroke={getColor(score)}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center ${fontSize} font-bold`}>
          {score}
        </span>
      </div>
      <span className="text-sm text-muted-foreground mt-2">{label}</span>
    </div>
  );
};

// Issue type icons and labels
const issueTypeConfig: Record<string, { label: string; color: string }> = {
  pii: { label: 'PII Exposure', color: 'bg-red-100 text-red-800' },
  cve: { label: 'Vulnerability', color: 'bg-orange-100 text-orange-800' },
  port: { label: 'Open Port', color: 'bg-yellow-100 text-yellow-800' },
  cloud: { label: 'Cloud Storage', color: 'bg-blue-100 text-blue-800' },
  email: { label: 'Email Security', color: 'bg-purple-100 text-purple-800' },
};

export default function WhatIfSimulator({
  currentScore,
  topIssues,
  onSimulate
}: WhatIfSimulatorProps) {
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [projectedScore, setProjectedScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Calculate projected score locally when issues are toggled
  useEffect(() => {
    if (selectedIssues.size === 0) {
      setProjectedScore(null);
      return;
    }

    const totalImpact = topIssues
      .filter(issue => selectedIssues.has(issue.id))
      .reduce((sum, issue) => sum + issue.impact, 0);

    // Simple projection: current score + removed penalties (capped at 100)
    const projected = Math.min(100, currentScore + totalImpact);
    setProjectedScore(projected);
  }, [selectedIssues, topIssues, currentScore]);

  const toggleIssue = (issueId: string) => {
    const newSelected = new Set(selectedIssues);
    if (newSelected.has(issueId)) {
      newSelected.delete(issueId);
    } else {
      newSelected.add(issueId);
    }
    setSelectedIssues(newSelected);
  };

  const handleSimulate = async () => {
    if (!onSimulate || selectedIssues.size === 0) return;

    setLoading(true);
    try {
      const result = await onSimulate(Array.from(selectedIssues));
      setProjectedScore(result.projected_score);
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectAll = () => {
    setSelectedIssues(new Set(topIssues.map(i => i.id)));
  };

  const clearAll = () => {
    setSelectedIssues(new Set());
  };

  const scoreImprovement = projectedScore !== null ? projectedScore - currentScore : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-500" />
          What-If Simulator
        </CardTitle>
        <CardDescription>
          Select issues to see how remediation would improve the security score
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Score Comparison */}
          <div className="flex items-center justify-center gap-8">
            <ScoreGauge score={currentScore} label="Current" />
            {projectedScore !== null && (
              <>
                <ChevronRight className="w-8 h-8 text-muted-foreground" />
                <ScoreGauge score={projectedScore} label="Projected" />
              </>
            )}
          </div>

          {/* Improvement Summary */}
          {projectedScore !== null && (
            <div className="flex flex-col justify-center">
              <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <TrendingUp className="w-5 h-5" />
                  <span className="font-medium">Potential Improvement</span>
                </div>
                <div className="mt-2 text-3xl font-bold text-green-600">
                  +{scoreImprovement} points
                </div>
                <p className="mt-1 text-sm text-green-700 dark:text-green-400">
                  By addressing {selectedIssues.size} issue{selectedIssues.size !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Issue Selection */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">Top Issues to Address</h4>
            <div className="flex gap-2">
              <Button id="select-all-issues-btn" variant="ghost" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button id="clear-all-issues-btn" variant="ghost" size="sm" onClick={clearAll}>
                Clear
              </Button>
            </div>
          </div>

          {topIssues.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Check className="w-12 h-12 mx-auto mb-2 text-green-500" />
              <p>No significant issues found!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topIssues.map((issue) => {
                const typeConfig = issueTypeConfig[issue.type] || issueTypeConfig.pii;
                const isSelected = selectedIssues.has(issue.id);

                return (
                  <div
                    key={issue.id}
                    onClick={() => toggleIssue(issue.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                        isSelected ? 'bg-primary border-primary' : 'border-gray-300'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeConfig.color}`}>
                        {typeConfig.label}
                      </span>
                      <span className="flex-1 text-sm">{issue.description}</span>
                      <span className="text-sm font-medium text-red-600">-{issue.impact}</span>
                    </div>
                    {issue.remediation && isSelected && (
                      <div className="mt-2 ml-8 text-xs text-muted-foreground">
                        💡 {issue.remediation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Button */}
        {onSimulate && selectedIssues.size > 0 && (
          <div className="mt-6 flex justify-end">
            <Button id="run-simulation-btn" onClick={handleSimulate} disabled={loading}>
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Calculating...
                </>
              ) : (
                <>
                  <Lightbulb className="w-4 h-4 mr-2" />
                  Run Detailed Simulation
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
