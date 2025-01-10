'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { ITimePeriodSettings, ITimePeriod } from '@/interfaces/timeEntry.interfaces';
import TimePeriodForm from './TimePeriodForm';
import { getTimePeriodSettings } from '@/lib/actions/timePeriodsActions';
import { ISO8601String } from '@/types/types.d';
import { parseISO, format } from 'date-fns'; // Import date-fns functions

interface TimePeriodsProps {
  initialTimePeriods: ITimePeriod[];
}

const TimePeriods: React.FC<TimePeriodsProps> = ({ initialTimePeriods }) => {
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [timePeriods, setTimePeriods] = useState<ITimePeriod[]>(initialTimePeriods);
  const [settings, setSettings] = useState<ITimePeriodSettings | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<ITimePeriod | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');

  const handleTimePeriodCreated = (newPeriod: ITimePeriod) => {
    if (mode === 'edit') {
      setTimePeriods(timePeriods.map((p):ITimePeriod => 
        p.period_id === newPeriod.period_id ? newPeriod : p
      ));
    } else {
      setTimePeriods([...timePeriods, newPeriod]);
    }
  };

  const handleTimePeriodDeleted = () => {
    if (selectedPeriod) {
      setTimePeriods(timePeriods.filter(p => p.period_id !== selectedPeriod.period_id));
    }
  };

  const handleEdit = (period: ITimePeriod) => {
    setSelectedPeriod(period);
    setMode('edit');
    setIsFormOpen(true);
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setSelectedPeriod(null);
    setMode('create');
  };

  useEffect(() => {
    console.log('initial time periods', initialTimePeriods);

    async function fetchSettings() {
      const timePeriodSettings = await getTimePeriodSettings();
      // Assuming we only have one active setting
      setSettings(timePeriodSettings[0]);
    }
    fetchSettings();
  }, []);

  // Function to format ISO8601 string to a readable date string
  const formatDate = (isoString: ISO8601String): string => {
    // Parse as UTC and format in UTC
    return isoString.slice(0, 10);
  };

  return (
    <>
      <Button 
        id="create-time-period-button"
        className="mb-4" 
        onClick={() => {
          setMode('create');
          setSelectedPeriod(null);
          setIsFormOpen(true);
        }}
      >
        Create New Time Period
      </Button>
      <TimePeriodForm
        isOpen={isFormOpen}
        onClose={handleClose}
        onTimePeriodCreated={handleTimePeriodCreated}
        onTimePeriodDeleted={handleTimePeriodDeleted}
        settings={settings}
        existingTimePeriods={timePeriods}
        selectedPeriod={selectedPeriod}
        mode={mode}
      />
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Time Period Management</h3>
          <p className="text-sm text-gray-500">Manage billing cycles and time periods</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timePeriods.map((period): JSX.Element => (
                <TableRow key={period.period_id}>
                  <TableCell>{period.start_date.slice(0, 10)}</TableCell>
                  <TableCell>{period.end_date.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Button 
                      id={`edit-period-${period.period_id}`}
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleEdit(period)}
                      className="mr-2"
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
};

export default TimePeriods;
