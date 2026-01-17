'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import {
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Building2,
  Target,
  FileBarChart
} from 'lucide-react';
import Link from 'next/link';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

// Types for Security Scores
interface CompanyScore {
  company_id: string;
  company_name: string;
  score: number;
  risk_level: 'critical' | 'high' | 'moderate' | 'low';
  previous_score?: number;
  score_delta?: number;
  last_calculated_at: string;
}

interface PortfolioSummary {
  total_companies: number;
  average_score: number;
  risk_distribution: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
  most_improved: CompanyScore[];
  most_declined: CompanyScore[];
}

// Risk level badge component
const RiskBadge: React.FC<{ level: string }> = ({ level }) => {
  const levelConfig: Record<string, { className: string; label: string }> = {
    critical: { className: 'bg-red-100 text-red-800', label: 'Critical' },
    high: { className: 'bg-orange-100 text-orange-800', label: 'High' },
    moderate: { className: 'bg-yellow-100 text-yellow-800', label: 'Moderate' },
    low: { className: 'bg-green-100 text-green-800', label: 'Low' },
  };

  const config = levelConfig[level] || levelConfig.moderate;

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
};

// Score gauge component
const ScoreGauge: React.FC<{ score: number; size?: 'sm' | 'md' | 'lg' }> = ({ score, size = 'md' }) => {
  const sizeConfig = {
    sm: { width: 60, height: 60, strokeWidth: 4, fontSize: 'text-sm' },
    md: { width: 100, height: 100, strokeWidth: 6, fontSize: 'text-xl' },
    lg: { width: 150, height: 150, strokeWidth: 8, fontSize: 'text-3xl' },
  };

  const { width, height, strokeWidth, fontSize } = sizeConfig[size];
  const radius = (width - strokeWidth) / 2;
  const circumference = radius * Math.PI * 2;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return '#22c55e'; // green
    if (s >= 60) return '#eab308'; // yellow
    if (s >= 40) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  return (
    <div className="relative inline-flex items-center justify-center">
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
        />
      </svg>
      <span className={`absolute ${fontSize} font-bold`}>{score}</span>
    </div>
  );
};

// Trend indicator component
const TrendIndicator: React.FC<{ delta?: number }> = ({ delta }) => {
  if (!delta || delta === 0) {
    return <Minus className="w-4 h-4 text-gray-400" />;
  }

  if (delta > 0) {
    return (
      <span className="flex items-center text-green-600 text-sm">
        <TrendingUp className="w-4 h-4 mr-1" />
        +{delta}
      </span>
    );
  }

  return (
    <span className="flex items-center text-red-600 text-sm">
      <TrendingDown className="w-4 h-4 mr-1" />
      {delta}
    </span>
  );
};

export default function SecurityScores() {
  const [scores, setScores] = useState<CompanyScore[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScores = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/scores');
      if (response.ok) {
        const data = await response.json();
        setScores(data.scores || []);
      }
    } catch (err) {
      console.error('Failed to fetch scores:', err);
    }
  }, []);

  const fetchPortfolio = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/scores/portfolio');
      if (response.ok) {
        const data = await response.json();
        setPortfolio(data);
      }
    } catch (err) {
      console.error('Failed to fetch portfolio:', err);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([fetchScores(), fetchPortfolio()]);
      } catch (err) {
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchScores, fetchPortfolio]);

  const handleRecalculate = async (companyId: string) => {
    try {
      const response = await fetch(`/api/guard/scores/${companyId}/recalculate`, {
        method: 'POST',
      });
      if (response.ok) {
        await fetchScores();
      }
    } catch (err) {
      console.error('Failed to recalculate score:', err);
    }
  };

  const scoreColumns: ColumnDefinition<CompanyScore>[] = [
    {
      title: 'Company',
      dataIndex: 'company_name',
      render: (value, record) => (
        <Link href={`/msp/guard/scores/${record.company_id}`} className="flex items-center gap-2 hover:text-primary">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          {value as string}
        </Link>
      )
    },
    {
      title: 'Score',
      dataIndex: 'score',
      render: (value) => <ScoreGauge score={value as number} size="sm" />
    },
    {
      title: 'Risk Level',
      dataIndex: 'risk_level',
      render: (value) => <RiskBadge level={value as string} />
    },
    {
      title: 'Trend',
      dataIndex: 'score_delta',
      render: (value) => <TrendIndicator delta={value as number | undefined} />
    },
    {
      title: 'Last Updated',
      dataIndex: 'last_calculated_at',
      render: (value) => new Date(value as string).toLocaleString()
    },
    {
      title: 'Actions',
      dataIndex: 'company_id',
      render: (value) => (
        <div className="flex items-center gap-2">
          <Link href={`/msp/guard/scores/${value}`}>
            <Button id={`view-score-${value}`} variant="ghost" size="sm" title="View Details">
              <Target className="w-4 h-4" />
            </Button>
          </Link>
          <Button
            id={`recalc-score-${value}`}
            variant="ghost"
            size="sm"
            onClick={() => handleRecalculate(value as string)}
            title="Recalculate"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Link href={`/msp/guard/reports?company=${value}&type=security_score`}>
            <Button id={`report-score-${value}`} variant="ghost" size="sm" title="Generate Report">
              <FileBarChart className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="bg-red-50 border-red-200">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-600">
              <AlertTriangle className="w-5 h-5 mr-2" />
              {error}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Security Scores</h1>
          <p className="text-muted-foreground">Client risk assessment portfolio</p>
        </div>
        <Button id="refresh-scores-btn" variant="outline" onClick={() => { fetchScores(); fetchPortfolio(); }}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Portfolio Summary */}
      {portfolio && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio Average</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreGauge score={Math.round(portfolio.average_score)} size="md" />
            </CardContent>
          </Card>
          <Card className="bg-red-50 dark:bg-red-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-700">Critical Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{portfolio.risk_distribution.critical}</div>
              <p className="text-xs text-muted-foreground">Score 0-39</p>
            </CardContent>
          </Card>
          <Card className="bg-orange-50 dark:bg-orange-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-700">High Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">{portfolio.risk_distribution.high}</div>
              <p className="text-xs text-muted-foreground">Score 40-59</p>
            </CardContent>
          </Card>
          <Card className="bg-yellow-50 dark:bg-yellow-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-700">Moderate Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-600">{portfolio.risk_distribution.moderate}</div>
              <p className="text-xs text-muted-foreground">Score 60-79</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50 dark:bg-green-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-700">Low Risk</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{portfolio.risk_distribution.low}</div>
              <p className="text-xs text-muted-foreground">Score 80-100</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Scores Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Companies</CardTitle>
          <CardDescription>Security scores for all monitored companies</CardDescription>
        </CardHeader>
        <CardContent>
          {scores.length === 0 ? (
            <div className="text-center py-12">
              <Target className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No security scores yet</h3>
              <p className="text-muted-foreground">Scores will be calculated after running PII or ASM scans</p>
            </div>
          ) : (
            <DataTable
              columns={scoreColumns}
              data={scores}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
