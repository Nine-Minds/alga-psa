'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { FileWarning, Building2, AlertTriangle, Shield } from 'lucide-react';

// PII type configuration for display
const PII_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  ssn: { label: 'Social Security', color: '#ef4444' },
  credit_card: { label: 'Credit Card', color: '#f97316' },
  bank_account: { label: 'Bank Account', color: '#eab308' },
  dob: { label: 'Date of Birth', color: '#84cc16' },
  drivers_license: { label: "Driver's License", color: '#22c55e' },
  passport: { label: 'Passport', color: '#14b8a6' },
  email: { label: 'Email', color: '#06b6d4' },
  phone: { label: 'Phone', color: '#3b82f6' },
  ip_address: { label: 'IP Address', color: '#8b5cf6' },
  mac_address: { label: 'MAC Address', color: '#d946ef' },
};

interface PiiByTypeData {
  type: string;
  count: number;
}

interface PiiByCompanyData {
  companyId: string;
  companyName: string;
  count: number;
}

interface PiiTypePieChartProps {
  data: PiiByTypeData[];
}

interface PiiByCompanyBarChartProps {
  data: PiiByCompanyData[];
  maxDisplay?: number;
}

// Pure SVG Pie Chart for PII by Type (F227)
export function PiiTypePieChart({ data }: PiiTypePieChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileWarning className="w-5 h-5 text-orange-500" />
            PII Findings by Type
          </CardTitle>
          <CardDescription>Distribution of PII types detected</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-48">
            <div className="text-center">
              <Shield className="w-12 h-12 mx-auto text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">No PII findings to display</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const size = 200;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = 80;
  const innerRadius = 45; // Donut hole

  // Calculate pie slices
  let currentAngle = -90; // Start at top
  const slices = data.map((item) => {
    const percentage = item.count / total;
    const angle = percentage * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    const config = PII_TYPE_CONFIG[item.type] || { label: item.type, color: '#9ca3af' };

    // Convert angles to radians
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    // Calculate arc paths
    const largeArcFlag = angle > 180 ? 1 : 0;

    // Outer arc
    const x1 = centerX + radius * Math.cos(startRad);
    const y1 = centerY + radius * Math.sin(startRad);
    const x2 = centerX + radius * Math.cos(endRad);
    const y2 = centerY + radius * Math.sin(endRad);

    // Inner arc (for donut)
    const ix1 = centerX + innerRadius * Math.cos(endRad);
    const iy1 = centerY + innerRadius * Math.sin(endRad);
    const ix2 = centerX + innerRadius * Math.cos(startRad);
    const iy2 = centerY + innerRadius * Math.sin(startRad);

    const pathD = `
      M ${x1} ${y1}
      A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}
      L ${ix1} ${iy1}
      A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${ix2} ${iy2}
      Z
    `;

    return {
      ...item,
      pathD,
      color: config.color,
      label: config.label,
      percentage: Math.round(percentage * 100),
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileWarning className="w-5 h-5 text-orange-500" />
          PII Findings by Type
        </CardTitle>
        <CardDescription>Distribution of PII types detected</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center gap-8">
          {/* Pie Chart */}
          <div className="relative">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              {slices.map((slice, i) => (
                <path
                  key={i}
                  d={slice.pathD}
                  fill={slice.color}
                  className="hover:opacity-80 transition-opacity cursor-pointer"
                />
              ))}
            </svg>
            {/* Center total */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">{total}</span>
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-col gap-2">
            {slices.slice(0, 6).map((slice, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="truncate max-w-[100px]">{slice.label}</span>
                <span className="text-muted-foreground">({slice.count})</span>
              </div>
            ))}
            {slices.length > 6 && (
              <div className="text-xs text-muted-foreground">
                +{slices.length - 6} more types
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Pure SVG Bar Chart for PII by Company (F228)
export function PiiByCompanyBarChart({ data, maxDisplay = 8 }: PiiByCompanyBarChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-500" />
            PII Findings by Company
          </CardTitle>
          <CardDescription>Top companies by PII exposure</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-48">
            <div className="text-center">
              <Shield className="w-12 h-12 mx-auto text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">No company data to display</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort by count descending and limit
  const sortedData = [...data]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxDisplay);

  const maxCount = Math.max(...sortedData.map(d => d.count));
  const barHeight = 28;
  const labelWidth = 120;
  const chartWidth = 280;
  const padding = 8;

  // Color gradient based on count (red = high, yellow = medium, green = low)
  const getBarColor = (count: number): string => {
    const ratio = count / maxCount;
    if (ratio >= 0.7) return '#ef4444'; // Red for high
    if (ratio >= 0.4) return '#f97316'; // Orange for medium
    if (ratio >= 0.2) return '#eab308'; // Yellow for lower
    return '#22c55e'; // Green for lowest
  };

  const svgHeight = sortedData.length * (barHeight + padding) + padding;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-500" />
          PII Findings by Company
        </CardTitle>
        <CardDescription>Top companies by PII exposure</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <svg
            width={labelWidth + chartWidth + 50}
            height={svgHeight}
            viewBox={`0 0 ${labelWidth + chartWidth + 50} ${svgHeight}`}
          >
            {sortedData.map((item, i) => {
              const y = padding + i * (barHeight + padding);
              const barWidth = (item.count / maxCount) * chartWidth;

              return (
                <g key={item.companyId}>
                  {/* Company name */}
                  <text
                    x={labelWidth - 8}
                    y={y + barHeight / 2 + 4}
                    textAnchor="end"
                    className="fill-foreground text-xs"
                  >
                    {item.companyName.length > 16
                      ? item.companyName.slice(0, 16) + '...'
                      : item.companyName}
                  </text>

                  {/* Background bar */}
                  <rect
                    x={labelWidth}
                    y={y}
                    width={chartWidth}
                    height={barHeight}
                    fill="#f3f4f6"
                    rx={4}
                  />

                  {/* Data bar */}
                  <rect
                    x={labelWidth}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={getBarColor(item.count)}
                    rx={4}
                    className="hover:opacity-80 transition-opacity"
                  />

                  {/* Count label */}
                  <text
                    x={labelWidth + barWidth + 8}
                    y={y + barHeight / 2 + 4}
                    textAnchor="start"
                    className="fill-foreground text-xs font-medium"
                  >
                    {item.count}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {data.length > maxDisplay && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            Showing top {maxDisplay} of {data.length} companies
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Combined dashboard component for both charts
interface PiiDashboardChartsProps {
  piiByType: PiiByTypeData[];
  piiByCompany: PiiByCompanyData[];
}

export default function PiiDashboardCharts({ piiByType, piiByCompany }: PiiDashboardChartsProps) {
  const totalFindings = piiByType.reduce((sum, d) => sum + d.count, 0);
  const companiesAffected = piiByCompany.filter(c => c.count > 0).length;
  const criticalTypes = ['ssn', 'credit_card', 'bank_account'];
  const criticalCount = piiByType
    .filter(d => criticalTypes.includes(d.type))
    .reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total PII Findings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalFindings}</div>
            <p className="text-xs text-muted-foreground">Across all scans</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Companies Affected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{companiesAffected}</div>
            <p className="text-xs text-muted-foreground">
              of {piiByCompany.length} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Critical Findings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{criticalCount}</div>
            <p className="text-xs text-muted-foreground">SSN, Credit Card, Bank</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PiiTypePieChart data={piiByType} />
        <PiiByCompanyBarChart data={piiByCompany} />
      </div>
    </div>
  );
}
