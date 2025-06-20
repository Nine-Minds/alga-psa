'use client'

import React, { useEffect, useState } from 'react';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { toast } from 'react-hot-toast';
import { getAllPrioritiesWithStandard } from 'server/src/lib/actions/priorityActions';
import { getTicketPrioritySettings, updateTicketPrioritySettings, PriorityMatrix, DEFAULT_MATRIX } from 'server/src/lib/actions/ticketPrioritySettingsActions';
import { IPriority, IStandardPriority, PriorityLevel } from 'server/src/interfaces';

const LEVELS: PriorityLevel[] = ['low', 'medium', 'high'];

const PriorityMatrixSettings: React.FC = () => {
  const [priorities, setPriorities] = useState<(IPriority | IStandardPriority)[]>([]);
  const [matrix, setMatrix] = useState<PriorityMatrix>(DEFAULT_MATRIX);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [p, s] = await Promise.all([
          getAllPrioritiesWithStandard(),
          getTicketPrioritySettings()
        ]);
        setPriorities(p);
        setMatrix(s.priorityMatrix);
        setEnabled(s.usePriorityMatrix);
      } catch (e) {
        console.error(e);
        toast.error('Failed to load priority settings');
      }
    };
    load();
  }, []);

  const handleSelect = (impact: PriorityLevel, urgency: PriorityLevel, value: string) => {
    setMatrix(prev => ({
      ...prev,
      [impact]: { ...prev[impact], [urgency]: value }
    }));
  };

  const save = async () => {
    try {
      await updateTicketPrioritySettings({ usePriorityMatrix: enabled, priorityMatrix: matrix });
      toast.success('Priority matrix updated');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save settings');
    }
  };

  const priorityOptions = priorities.map(p => ({ value: p.priority_id, label: p.priority_name }));

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Switch id="enable-priority-matrix" checked={enabled} onCheckedChange={setEnabled} />
        <div className="space-y-1">
          <Label htmlFor="enable-priority-matrix">Enable ITIL Priority Matrix</Label>
          <p className="text-sm text-muted-foreground">Calculate priority from impact and urgency</p>
        </div>
      </div>

      {enabled && (
        <div className="space-y-2">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="p-2 border" />
                {LEVELS.map(u => (
                  <th key={u} className="p-2 border capitalize">{u}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEVELS.map(impact => (
                <tr key={impact}>
                  <td className="p-2 border capitalize font-medium">{impact}</td>
                  {LEVELS.map(urgency => (
                    <td key={urgency} className="p-2 border">
                      <CustomSelect
                        value={matrix[impact][urgency] || ''}
                        onValueChange={(val) => handleSelect(impact, urgency, val)}
                        options={priorityOptions}
                        className="w-32"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Button id="save-priority-matrix" onClick={save} className="mt-2">Save</Button>
        </div>
      )}
    </div>
  );
};

export default PriorityMatrixSettings;
