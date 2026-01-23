import React from 'react';
import { BarChart3, PieChart, TrendingUp } from 'lucide-react';

interface ChartSkeletonProps {
  height?: string;
  type?: 'bar' | 'pie' | 'radial' | 'line';
  title?: string;
  showLegend?: boolean;
}

const ChartSkeleton = ({ 
  height = "300px", 
  type = "bar",
  title = "Chart",
  showLegend = true
}: ChartSkeletonProps) => {
  const getChartIcon = () => {
    switch (type) {
      case 'pie':
      case 'radial':
        return <PieChart className="h-8 w-8 text-gray-300" />;
      case 'line':
        return <TrendingUp className="h-8 w-8 text-gray-300" />;
      default:
        return <BarChart3 className="h-8 w-8 text-gray-300" />;
    }
  };

  const renderBarChart = () => (
    <div className="flex items-end justify-center space-x-2 h-full">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col items-center space-y-2">
          <div 
            className="bg-blue-200 rounded-t w-8 animate-pulse"
            style={{ height: `${Math.random() * 60 + 20}%` }}
          ></div>
          <div className="h-3 bg-gray-200 rounded w-6"></div>
        </div>
      ))}
    </div>
  );

  const renderPieChart = () => (
    <div className="flex items-center justify-center h-full">
      <div className="relative">
        <div className="w-32 h-32 border-8 border-gray-200 rounded-full"></div>
        <div className="absolute top-0 left-0 w-32 h-32 border-8 border-blue-200 rounded-full border-r-transparent border-b-transparent animate-pulse"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 bg-white rounded-full border-4 border-gray-100"></div>
        </div>
      </div>
    </div>
  );

  const renderRadialChart = () => (
    <div className="flex items-center justify-center h-full">
      <div className="relative">
        <div className="w-24 h-24 border-4 border-gray-200 rounded-full"></div>
        <div className="absolute top-0 left-0 w-24 h-24 border-4 border-green-200 rounded-full border-l-transparent border-b-transparent animate-pulse"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="h-4 bg-gray-200 rounded w-8 mx-auto mb-1"></div>
            <div className="h-3 bg-gray-200 rounded w-6 mx-auto"></div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderLineChart = () => (
    <div className="flex items-end justify-center space-x-1 h-full">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col items-center space-y-2">
          <div 
            className="bg-purple-200 rounded w-2 animate-pulse"
            style={{ height: `${Math.random() * 80 + 10}%` }}
          ></div>
          <div className="h-2 bg-gray-200 rounded w-4"></div>
        </div>
      ))}
    </div>
  );

  const renderChart = () => {
    switch (type) {
      case 'pie':
        return renderPieChart();
      case 'radial':
        return renderRadialChart();
      case 'line':
        return renderLineChart();
      default:
        return renderBarChart();
    }
  };

  return (
    <div className="animate-pulse border rounded-lg overflow-hidden bg-white">
      {/* Chart Header */}
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {getChartIcon()}
            <div>
              <div className="h-5 bg-gray-200 rounded w-24 mb-1"></div>
              <div className="h-3 bg-gray-200 rounded w-32"></div>
            </div>
          </div>
          <div className="flex space-x-2">
            <div className="h-6 bg-gray-200 rounded w-16"></div>
            <div className="h-6 bg-gray-200 rounded w-12"></div>
          </div>
        </div>
      </div>
      
      {/* Chart Content */}
      <div className="p-4">
        <div className="relative" style={{ height }}>
          {renderChart()}
          
          {/* Chart axes for bar/line charts */}
          {(type === 'bar' || type === 'line') && (
            <>
              {/* Y-axis */}
              <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between text-xs">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="h-2 bg-gray-200 rounded w-6"></div>
                ))}
              </div>
              
              {/* X-axis */}
              <div className="absolute bottom-0 left-8 right-0 h-8 flex items-center justify-between">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-2 bg-gray-200 rounded w-8"></div>
                ))}
              </div>
            </>
          )}
          
          {/* Loading overlay */}
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mb-2"></div>
              <p className="text-gray-500 text-sm">Loading {title.toLowerCase()}...</p>
            </div>
          </div>
        </div>
        
        {/* Legend */}
        {showLegend && (
          <div className="mt-4 flex items-center justify-center space-x-6">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded ${i === 0 ? 'bg-blue-200' : i === 1 ? 'bg-green-200' : 'bg-purple-200'}`}></div>
                <div className="h-3 bg-gray-200 rounded w-16"></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChartSkeleton;
