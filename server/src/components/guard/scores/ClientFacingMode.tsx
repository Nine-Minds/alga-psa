'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import {
  EyeOff,
  Shield,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Download,
  Presentation
} from 'lucide-react';

interface ClientFacingModeProps {
  companyName: string;
  currentScore: number;
  previousScore?: number;
  riskLevel: 'critical' | 'high' | 'moderate' | 'low';
  topIssuesCount: number;
  improvementPotential: number;
  onExportReport?: () => void;
}

// Risk level configuration
const riskConfig: Record<string, { label: string; color: string; bgColor: string; description: string }> = {
  critical: {
    label: 'Critical Risk',
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-950/30',
    description: 'Immediate attention required - significant security vulnerabilities detected',
  },
  high: {
    label: 'High Risk',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100 dark:bg-orange-950/30',
    description: 'Several security concerns need to be addressed soon',
  },
  moderate: {
    label: 'Moderate Risk',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100 dark:bg-yellow-950/30',
    description: 'Some improvements recommended for better security posture',
  },
  low: {
    label: 'Low Risk',
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-950/30',
    description: 'Good security posture - continue monitoring',
  },
};

// Score gauge for client presentation
const PresentationGauge: React.FC<{ score: number; size?: number }> = ({ score, size = 200 }) => {
  const strokeWidth = size * 0.08;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * Math.PI * 2;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return { main: '#22c55e', light: '#dcfce7' };
    if (s >= 60) return { main: '#eab308', light: '#fef9c3' };
    if (s >= 40) return { main: '#f97316', light: '#ffedd5' };
    return { main: '#ef4444', light: '#fee2e2' };
  };

  const colors = getColor(score);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.light}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.main}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-bold">{score}</span>
        <span className="text-sm text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
};

export default function ClientFacingMode({
  companyName,
  currentScore,
  previousScore,
  riskLevel,
  topIssuesCount,
  improvementPotential,
  onExportReport,
}: ClientFacingModeProps) {
  const [isClientMode, setIsClientMode] = useState(false);
  const risk = riskConfig[riskLevel] || riskConfig.moderate;
  const scoreDelta = previousScore ? currentScore - previousScore : null;

  if (!isClientMode) {
    // Toggle button to enter client mode
    return (
      <Button
        id="enter-client-mode-btn"
        variant="outline"
        onClick={() => setIsClientMode(true)}
        className="flex items-center gap-2"
      >
        <Presentation className="w-4 h-4" />
        Client Presentation Mode
      </Button>
    );
  }

  // Full client-facing presentation
  return (
    <div className="fixed inset-0 bg-background z-50 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-background border-b z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Security Assessment</h1>
              <p className="text-sm text-muted-foreground">{companyName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {onExportReport && (
              <Button id="export-report-btn" variant="outline" onClick={onExportReport}>
                <Download className="w-4 h-4 mr-2" />
                Export Report
              </Button>
            )}
            <Button id="exit-client-mode-btn" variant="ghost" onClick={() => setIsClientMode(false)}>
              <EyeOff className="w-4 h-4 mr-2" />
              Exit Presentation
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        {/* Score Section */}
        <div className="text-center mb-12">
          <PresentationGauge score={currentScore} size={200} />

          <div className={`mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full ${risk.bgColor}`}>
            {riskLevel === 'low' ? (
              <CheckCircle className={`w-5 h-5 ${risk.color}`} />
            ) : (
              <AlertTriangle className={`w-5 h-5 ${risk.color}`} />
            )}
            <span className={`font-semibold ${risk.color}`}>{risk.label}</span>
          </div>

          <p className="mt-4 text-muted-foreground max-w-md mx-auto">
            {risk.description}
          </p>

          {scoreDelta !== null && (
            <div className="mt-4">
              {scoreDelta > 0 ? (
                <span className="inline-flex items-center gap-1 text-green-600">
                  <TrendingUp className="w-5 h-5" />
                  <span className="font-medium">+{scoreDelta} points since last assessment</span>
                </span>
              ) : scoreDelta < 0 ? (
                <span className="inline-flex items-center gap-1 text-red-600">
                  <TrendingUp className="w-5 h-5 rotate-180" />
                  <span className="font-medium">{scoreDelta} points since last assessment</span>
                </span>
              ) : (
                <span className="text-muted-foreground">No change since last assessment</span>
              )}
            </div>
          )}
        </div>

        {/* Key Metrics */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Security Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold">{currentScore}</div>
              <div className="text-sm text-muted-foreground">out of 100</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Issues Identified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold">{topIssuesCount}</div>
              <div className="text-sm text-muted-foreground">requiring attention</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Improvement Potential
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600">+{improvementPotential}</div>
              <div className="text-sm text-muted-foreground">points with remediation</div>
            </CardContent>
          </Card>
        </div>

        {/* Call to Action */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-8 text-center">
            <h2 className="text-2xl font-bold mb-4">Ready to Improve Your Security?</h2>
            <p className="text-muted-foreground max-w-lg mx-auto mb-6">
              Our team can help you address the identified issues and improve your security score.
              Let's discuss a remediation plan tailored to your needs.
            </p>
            <Button id="schedule-consultation-btn" size="lg">
              Schedule a Consultation
            </Button>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-muted-foreground">
          <p>Assessment generated on {new Date().toLocaleDateString()}</p>
          <p className="mt-1">Powered by Alga Guard Security Assessment Platform</p>
        </div>
      </div>
    </div>
  );
}
