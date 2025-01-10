// Reports.tsx
import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import CustomSelect from '@/components/ui/CustomSelect';

// You'll need to create these functions
// import { generateRevenueByCycle, generateBillableHoursByCycle, generateClientProfitability } from ''lib/actions/reportActions'' (see below for file content);

const REPORT_TYPE_OPTIONS = [
  { value: 'revenue', label: 'Revenue by Time Period' },
  { value: 'billableHours', label: 'Billable Hours by Time Period' },
  { value: 'clientProfitability', label: 'Client Profitability' },
];

const TIME_PERIOD_OPTIONS = [
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'lastQuarter', label: 'Last Quarter' },
  { value: 'lastYear', label: 'Last Year' },
  { value: 'customRange', label: 'Custom Range' },
];

const Reports: React.FC = () => {
  const [selectedReport, setSelectedReport] = useState<string>('');
  const [timePeriod, setTimePeriod] = useState<string>('');
  const [reportData, setReportData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateReport = async () => {
    if (!selectedReport || !timePeriod) {
      setError('Please select both report type and time period');
      return;
    }

    try {
      let data;
      switch (selectedReport) {
        case 'revenue':
        //   data = await generateRevenueByCycle(timePeriod);
          break;
        case 'billableHours':
        //   data = await generateBillableHoursByCycle(timePeriod);
          break;
        case 'clientProfitability':
        //   data = await generateClientProfitability(timePeriod);
          break;
        default:
          throw new Error('Invalid report type');
      }
      setReportData(data);
      setError(null);
    } catch (error) {
      console.error('Error generating report:', error);
      setError('Failed to generate report');
    }
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Billing Reports</h3>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            {error}
          </div>
        )}
        <div className="space-y-4">
          <div className="w-fit">
            <CustomSelect
              options={REPORT_TYPE_OPTIONS}
              onValueChange={setSelectedReport}
              value={selectedReport}
              placeholder="Select report type..."
            />
          </div>
          <div className="w-fit">
            <CustomSelect
              options={TIME_PERIOD_OPTIONS}
              onValueChange={setTimePeriod}
              value={timePeriod}
              placeholder="Select time period..."
            />
          </div>
          <Button 
            id='generate-button'
            onClick={handleGenerateReport}
            disabled={!selectedReport || !timePeriod}
          >
            Generate Report
          </Button>
        </div>
        {reportData && (
          <div className="mt-4">
            <h4 className="text-lg font-semibold">Report Results</h4>
            {/* Render your report data here. This will depend on the structure of your report data. */}
            <pre>{JSON.stringify(reportData, null, 2)}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Reports;
