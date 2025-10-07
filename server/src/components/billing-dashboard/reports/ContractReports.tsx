'use client';

import React, { useState } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Badge } from 'server/src/components/ui/Badge';
import {
  DollarSign,
  Calendar,
  TrendingUp,
  Clock,
  Building2,
  AlertCircle
} from 'lucide-react';

// Mock data interfaces
interface ContractRevenue {
  contract_name: string;
  client_name: string;
  monthly_recurring: number;
  total_billed_ytd: number;
  status: 'active' | 'upcoming' | 'expired';
}

interface ContractExpiration {
  contract_name: string;
  client_name: string;
  end_date: string;
  days_until_expiration: number;
  monthly_value: number;
  auto_renew: boolean;
}

interface BucketUsage {
  contract_name: string;
  client_name: string;
  total_hours: number;
  used_hours: number;
  remaining_hours: number;
  utilization_percentage: number;
  overage_hours: number;
}

interface Profitability {
  contract_name: string;
  client_name: string;
  revenue: number;
  cost: number;
  profit: number;
  margin_percentage: number;
}

// Mock data generators
const generateMockRevenueData = (): ContractRevenue[] => [
  {
    contract_name: 'Standard MSP Services',
    client_name: 'Acme Corp',
    monthly_recurring: 500000, // $5,000.00
    total_billed_ytd: 4500000, // $45,000.00
    status: 'active'
  },
  {
    contract_name: 'Premium Support Package',
    client_name: 'TechStart Inc',
    monthly_recurring: 750000,
    total_billed_ytd: 6750000,
    status: 'active'
  },
  {
    contract_name: 'Enterprise Agreement',
    client_name: 'Global Industries',
    monthly_recurring: 1200000,
    total_billed_ytd: 10800000,
    status: 'active'
  },
  {
    contract_name: 'Basic Monitoring',
    client_name: 'Local Business LLC',
    monthly_recurring: 250000,
    total_billed_ytd: 2250000,
    status: 'active'
  }
];

const generateMockExpirationData = (): ContractExpiration[] => [
  {
    contract_name: 'Standard MSP Services',
    client_name: 'Acme Corp',
    end_date: '2025-11-15',
    days_until_expiration: 46,
    monthly_value: 500000,
    auto_renew: true
  },
  {
    contract_name: 'Premium Support Package',
    client_name: 'TechStart Inc',
    end_date: '2025-10-31',
    days_until_expiration: 31,
    monthly_value: 750000,
    auto_renew: false
  },
  {
    contract_name: 'Project-Based Services',
    client_name: 'StartUp Co',
    end_date: '2025-10-15',
    days_until_expiration: 15,
    monthly_value: 300000,
    auto_renew: false
  }
];

const generateMockBucketUsageData = (): BucketUsage[] => [
  {
    contract_name: 'Standard MSP Services',
    client_name: 'Acme Corp',
    total_hours: 40,
    used_hours: 32,
    remaining_hours: 8,
    utilization_percentage: 80,
    overage_hours: 0
  },
  {
    contract_name: 'Premium Support Package',
    client_name: 'TechStart Inc',
    total_hours: 80,
    used_hours: 95,
    remaining_hours: 0,
    utilization_percentage: 119,
    overage_hours: 15
  },
  {
    contract_name: 'Enterprise Agreement',
    client_name: 'Global Industries',
    total_hours: 160,
    used_hours: 142,
    remaining_hours: 18,
    utilization_percentage: 89,
    overage_hours: 0
  }
];

const generateMockProfitabilityData = (): Profitability[] => [
  {
    contract_name: 'Standard MSP Services',
    client_name: 'Acme Corp',
    revenue: 4500000,
    cost: 2700000,
    profit: 1800000,
    margin_percentage: 40
  },
  {
    contract_name: 'Premium Support Package',
    client_name: 'TechStart Inc',
    revenue: 6750000,
    cost: 4050000,
    profit: 2700000,
    margin_percentage: 40
  },
  {
    contract_name: 'Enterprise Agreement',
    client_name: 'Global Industries',
    revenue: 10800000,
    cost: 5400000,
    profit: 5400000,
    margin_percentage: 50
  }
];

const ContractReports: React.FC = () => {
  const [activeReport, setActiveReport] = useState('revenue');

  // Format currency
  const formatCurrency = (cents: number): string => {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Revenue Report Columns
  const revenueColumns: ColumnDefinition<ContractRevenue>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-gray-400" />
          {value}
        </div>
      )
    },
    {
      title: 'Monthly Recurring',
      dataIndex: 'monthly_recurring',
      render: (value: number) => <span className="font-semibold text-green-600">{formatCurrency(value)}</span>
    },
    {
      title: 'Total Billed (YTD)',
      dataIndex: 'total_billed_ytd',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => (
        <Badge
          variant="default"
          className={
            value === 'active' ? 'bg-green-100 text-green-800' :
            value === 'upcoming' ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-800'
          }
        >
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </Badge>
      )
    }
  ];

  // Expiration Report Columns
  const expirationColumns: ColumnDefinition<ContractExpiration>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name'
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value: string) => new Date(value).toLocaleDateString()
    },
    {
      title: 'Days Until Expiration',
      dataIndex: 'days_until_expiration',
      render: (value: number) => (
        <span className={value <= 30 ? 'text-red-600 font-semibold' : value <= 60 ? 'text-amber-600' : ''}>
          {value} days
        </span>
      )
    },
    {
      title: 'Monthly Value',
      dataIndex: 'monthly_value',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Auto-Renew',
      dataIndex: 'auto_renew',
      render: (value: boolean) => (
        <Badge variant="outline" className={value ? 'border-green-300 text-green-800' : 'border-gray-300 text-gray-600'}>
          {value ? 'Yes' : 'No'}
        </Badge>
      )
    }
  ];

  // Bucket Usage Columns
  const bucketUsageColumns: ColumnDefinition<BucketUsage>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name'
    },
    {
      title: 'Total Hours',
      dataIndex: 'total_hours',
      render: (value: number) => `${value} hrs`
    },
    {
      title: 'Used Hours',
      dataIndex: 'used_hours',
      render: (value: number) => `${value} hrs`
    },
    {
      title: 'Remaining',
      dataIndex: 'remaining_hours',
      render: (value: number) => (
        <span className={value === 0 ? 'text-red-600 font-semibold' : ''}>
          {value} hrs
        </span>
      )
    },
    {
      title: 'Utilization',
      dataIndex: 'utilization_percentage',
      render: (value: number) => (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
            <div
              className={`h-2 rounded-full ${value > 100 ? 'bg-red-500' : value > 80 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(value, 100)}%` }}
            />
          </div>
          <span className={`text-sm font-medium ${value > 100 ? 'text-red-600' : ''}`}>
            {value}%
          </span>
        </div>
      )
    },
    {
      title: 'Overage',
      dataIndex: 'overage_hours',
      render: (value: number) => (
        <span className={value > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>
          {value > 0 ? `+${value} hrs` : '—'}
        </span>
      )
    }
  ];

  // Profitability Columns
  const profitabilityColumns: ColumnDefinition<Profitability>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name'
    },
    {
      title: 'Revenue (YTD)',
      dataIndex: 'revenue',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Cost (YTD)',
      dataIndex: 'cost',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Profit',
      dataIndex: 'profit',
      render: (value: number) => (
        <span className="font-semibold text-green-600">{formatCurrency(value)}</span>
      )
    },
    {
      title: 'Margin',
      dataIndex: 'margin_percentage',
      render: (value: number) => (
        <Badge
          variant="default"
          className={value >= 40 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}
        >
          {value}%
        </Badge>
      )
    }
  ];

  // Calculate summary stats
  const revenueData = generateMockRevenueData();
  const totalMRR = revenueData.reduce((sum, item) => sum + item.monthly_recurring, 0);
  const totalYTD = revenueData.reduce((sum, item) => sum + item.total_billed_ytd, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Contract Reports</h2>
        <p className="text-gray-600 text-sm">
          Analyze contract performance, revenue, and utilization metrics
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-5 w-5 text-green-600" />
            <h3 className="font-semibold">Total MRR</h3>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(totalMRR)}</p>
          <p className="text-xs text-gray-500 mt-1">Monthly Recurring Revenue</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">YTD Revenue</h3>
          </div>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalYTD)}</p>
          <p className="text-xs text-gray-500 mt-1">Year to Date</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold">Active Contracts</h3>
          </div>
          <p className="text-2xl font-bold text-purple-600">{revenueData.length}</p>
          <p className="text-xs text-gray-500 mt-1">Billable clients</p>
        </Card>
      </div>

      {/* Info Alert */}
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-semibold mb-1">Using Mock Data</p>
          <p>These reports are currently displaying sample data for demonstration purposes. Connect to your actual billing data to see real-time insights.</p>
        </div>
      </div>

      {/* Report Tabs */}
      <Tabs value={activeReport} onValueChange={setActiveReport}>
        <TabsList>
          <TabsTrigger value="revenue">Contract Revenue</TabsTrigger>
          <TabsTrigger value="expiration">Expiration</TabsTrigger>
          <TabsTrigger value="bucket-usage">Bucket Hours</TabsTrigger>
          <TabsTrigger value="profitability">Profitability</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold">Contract Revenue Report</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Overview of monthly recurring revenue and year-to-date billing by contract
            </p>
            <DataTable
              data={revenueData}
              columns={revenueColumns}
            />
          </Card>
        </TabsContent>

        <TabsContent value="expiration" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5 text-amber-600" />
              <h3 className="text-lg font-semibold">Contract Expiration Report</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Track upcoming contract expirations and renewal opportunities
            </p>
            <DataTable
              data={generateMockExpirationData()}
              columns={expirationColumns}
            />
          </Card>
        </TabsContent>

        <TabsContent value="bucket-usage" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold">Bucket Hours Utilization</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Monitor bucket hours usage and identify overage situations
            </p>
            <DataTable
              data={generateMockBucketUsageData()}
              columns={bucketUsageColumns}
            />
          </Card>
        </TabsContent>

        <TabsContent value="profitability" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold">Simple Profitability Report</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Basic profit margins and revenue vs. cost analysis by contract
            </p>
            <DataTable
              data={generateMockProfitabilityData()}
              columns={profitabilityColumns}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContractReports;
