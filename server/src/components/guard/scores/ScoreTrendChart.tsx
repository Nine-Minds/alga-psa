'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ScoreHistoryPoint {
  date: string;
  score: number;
}

interface ScoreTrendChartProps {
  history: ScoreHistoryPoint[];
  currentScore: number;
}

// Score trend line chart using pure SVG
export default function ScoreTrendChart({ history, currentScore }: ScoreTrendChartProps) {
  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Score History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No historical data available yet
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate trend
  const oldestScore = history[0]?.score || currentScore;
  const scoreDelta = currentScore - oldestScore;
  const percentChange = oldestScore > 0 ? ((scoreDelta / oldestScore) * 100).toFixed(1) : '0';

  // SVG dimensions
  const width = 400;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 40, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate scales
  const scores = history.map(h => h.score);
  const minScore = Math.max(0, Math.min(...scores) - 10);
  const maxScore = Math.min(100, Math.max(...scores) + 10);
  const scoreRange = maxScore - minScore;

  // Generate path
  const points = history.map((point, i) => {
    const x = padding.left + (i / (history.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - ((point.score - minScore) / scoreRange) * chartHeight;
    return { x, y, ...point };
  });

  const pathD = points.length > 0
    ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`
    : '';

  // Area fill path
  const areaD = points.length > 0
    ? `${pathD} L ${points[points.length - 1].x},${padding.top + chartHeight} L ${points[0].x},${padding.top + chartHeight} Z`
    : '';

  // Get color based on current score
  const getScoreColor = (score: number) => {
    if (score >= 80) return '#22c55e'; // green
    if (score >= 60) return '#eab308'; // yellow
    if (score >= 40) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  const scoreColor = getScoreColor(currentScore);

  // Y-axis ticks
  const yTicks = [0, 25, 50, 75, 100].filter(t => t >= minScore && t <= maxScore);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Score History</CardTitle>
        <div className="flex items-center gap-2 text-sm">
          {scoreDelta > 0 ? (
            <span className="flex items-center text-green-600">
              <TrendingUp className="w-4 h-4 mr-1" />
              +{scoreDelta} ({percentChange}%)
            </span>
          ) : scoreDelta < 0 ? (
            <span className="flex items-center text-red-600">
              <TrendingDown className="w-4 h-4 mr-1" />
              {scoreDelta} ({percentChange}%)
            </span>
          ) : (
            <span className="flex items-center text-muted-foreground">
              <Minus className="w-4 h-4 mr-1" />
              No change
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          {/* Grid lines */}
          {yTicks.map((tick) => {
            const y = padding.top + chartHeight - ((tick - minScore) / scoreRange) * chartHeight;
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeDasharray="4"
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-xs"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path
            d={areaD}
            fill={scoreColor}
            fillOpacity={0.1}
          />

          {/* Line */}
          <path
            d={pathD}
            fill="none"
            stroke={scoreColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {points.map((point, i) => (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.y}
                r={4}
                fill={scoreColor}
                className="hover:r-6 transition-all cursor-pointer"
              />
              {/* Show label on hover would need JS, so show first and last */}
              {(i === 0 || i === points.length - 1) && (
                <text
                  x={point.x}
                  y={point.y - 10}
                  textAnchor="middle"
                  className="fill-foreground text-xs font-medium"
                >
                  {point.score}
                </text>
              )}
            </g>
          ))}

          {/* X-axis labels */}
          {points.filter((_, i) => i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)).map((point, i) => (
            <text
              key={i}
              x={point.x}
              y={height - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-xs"
            >
              {new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </text>
          ))}
        </svg>

        {/* Summary */}
        <div className="mt-4 grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <div className="text-muted-foreground">Starting</div>
            <div className="font-medium">{oldestScore}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Current</div>
            <div className="font-medium">{currentScore}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Change</div>
            <div className={`font-medium ${scoreDelta > 0 ? 'text-green-600' : scoreDelta < 0 ? 'text-red-600' : ''}`}>
              {scoreDelta > 0 ? '+' : ''}{scoreDelta}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
