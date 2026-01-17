'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { ScanSearch, Network, Target, FileBarChart, AlertTriangle, Shield, TrendingUp, TrendingDown } from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  pii: {
    totalFindings: number;
    criticalFindings: number;
    recentScans: number;
    companiesAffected: number;
  };
  asm: {
    totalDomains: number;
    activeDomains: number;
    totalFindings: number;
    criticalVulnerabilities: number;
  };
  scores: {
    averageScore: number;
    criticalCompanies: number;
    improvingCompanies: number;
    decliningCompanies: number;
  };
}

const StatCard: React.FC<{
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  href?: string;
  variant?: 'default' | 'warning' | 'danger' | 'success';
}> = ({ title, value, description, icon, trend, trendValue, href, variant = 'default' }) => {
  const variantStyles = {
    default: 'bg-card',
    warning: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800',
    danger: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800',
    success: 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800',
  };

  const content = (
    <Card className={`${variantStyles[variant]} transition-all hover:shadow-md`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        {trend && trendValue && (
          <div className={`flex items-center text-xs mt-2 ${
            trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-500'
          }`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3 mr-1" /> :
             trend === 'down' ? <TrendingDown className="w-3 h-3 mr-1" /> : null}
            {trendValue}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }

  return content;
};

export default function GuardDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        // Fetch PII dashboard stats
        const piiResponse = await fetch('/api/guard/pii/dashboard');
        const piiData = piiResponse.ok ? await piiResponse.json() : null;

        // Fetch ASM dashboard stats
        const asmResponse = await fetch('/api/guard/asm/dashboard');
        const asmData = asmResponse.ok ? await asmResponse.json() : null;

        // Fetch portfolio summary for scores
        const scoresResponse = await fetch('/api/guard/scores/portfolio');
        const scoresData = scoresResponse.ok ? await scoresResponse.json() : null;

        setStats({
          pii: {
            totalFindings: piiData?.total_findings || 0,
            criticalFindings: piiData?.findings_by_severity?.critical || 0,
            recentScans: piiData?.recent_scans || 0,
            companiesAffected: piiData?.companies_with_findings || 0,
          },
          asm: {
            totalDomains: asmData?.total_domains || 0,
            activeDomains: asmData?.domains_by_status?.enabled || 0,
            totalFindings: asmData?.total_findings || 0,
            criticalVulnerabilities: asmData?.findings_by_severity?.critical || 0,
          },
          scores: {
            averageScore: scoresData?.average_score || 0,
            criticalCompanies: scoresData?.risk_distribution?.critical || 0,
            improvingCompanies: scoresData?.most_improved?.length || 0,
            decliningCompanies: scoresData?.most_declined?.length || 0,
          },
        });
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
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
          <h1 className="text-2xl font-bold">Alga Guard</h1>
          <p className="text-muted-foreground">Security monitoring and compliance dashboard</p>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Security Score (Avg)"
          value={stats?.scores.averageScore || 0}
          description="Portfolio average"
          icon={<Shield className="w-5 h-5" />}
          href="/msp/guard/scores"
          variant={
            (stats?.scores.averageScore || 0) >= 80 ? 'success' :
            (stats?.scores.averageScore || 0) >= 60 ? 'default' :
            (stats?.scores.averageScore || 0) >= 40 ? 'warning' : 'danger'
          }
        />
        <StatCard
          title="PII Findings"
          value={stats?.pii.totalFindings || 0}
          description={`${stats?.pii.criticalFindings || 0} critical`}
          icon={<ScanSearch className="w-5 h-5" />}
          href="/msp/guard/pii"
          variant={(stats?.pii.criticalFindings || 0) > 0 ? 'danger' : 'default'}
        />
        <StatCard
          title="ASM Domains"
          value={stats?.asm.totalDomains || 0}
          description={`${stats?.asm.activeDomains || 0} active`}
          icon={<Network className="w-5 h-5" />}
          href="/msp/guard/asm"
        />
        <StatCard
          title="Critical Risk Companies"
          value={stats?.scores.criticalCompanies || 0}
          description="Score below 40"
          icon={<AlertTriangle className="w-5 h-5" />}
          href="/msp/guard/scores"
          variant={(stats?.scores.criticalCompanies || 0) > 0 ? 'danger' : 'success'}
        />
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/msp/guard/pii">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <ScanSearch className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <CardTitle>PII Scanner</CardTitle>
                  <CardDescription>Detect sensitive data exposure</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Findings</span>
                  <span className="font-medium">{stats?.pii.totalFindings || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Companies Affected</span>
                  <span className="font-medium">{stats?.pii.companiesAffected || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recent Scans</span>
                  <span className="font-medium">{stats?.pii.recentScans || 0}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/msp/guard/asm">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                  <Network className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <CardTitle>Attack Surface</CardTitle>
                  <CardDescription>External vulnerability monitoring</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monitored Domains</span>
                  <span className="font-medium">{stats?.asm.totalDomains || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Findings</span>
                  <span className="font-medium">{stats?.asm.totalFindings || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Critical CVEs</span>
                  <span className="font-medium text-red-600">{stats?.asm.criticalVulnerabilities || 0}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/msp/guard/scores">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                  <Target className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <CardTitle>Security Scores</CardTitle>
                  <CardDescription>Client risk assessment</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average Score</span>
                  <span className="font-medium">{stats?.scores.averageScore || 0}/100</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Improving</span>
                  <span className="font-medium text-green-600">{stats?.scores.improvingCompanies || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Declining</span>
                  <span className="font-medium text-red-600">{stats?.scores.decliningCompanies || 0}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link
              href="/msp/guard/pii?action=new-scan"
              className="flex flex-col items-center p-4 rounded-lg border hover:bg-muted transition-colors"
            >
              <ScanSearch className="w-8 h-8 mb-2 text-blue-600" />
              <span className="text-sm font-medium">New PII Scan</span>
            </Link>
            <Link
              href="/msp/guard/asm?action=add-domain"
              className="flex flex-col items-center p-4 rounded-lg border hover:bg-muted transition-colors"
            >
              <Network className="w-8 h-8 mb-2 text-purple-600" />
              <span className="text-sm font-medium">Add Domain</span>
            </Link>
            <Link
              href="/msp/guard/reports?action=new-report"
              className="flex flex-col items-center p-4 rounded-lg border hover:bg-muted transition-colors"
            >
              <FileBarChart className="w-8 h-8 mb-2 text-orange-600" />
              <span className="text-sm font-medium">Generate Report</span>
            </Link>
            <Link
              href="/msp/guard/schedules?action=new-schedule"
              className="flex flex-col items-center p-4 rounded-lg border hover:bg-muted transition-colors"
            >
              <Shield className="w-8 h-8 mb-2 text-green-600" />
              <span className="text-sm font-medium">New Schedule</span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
