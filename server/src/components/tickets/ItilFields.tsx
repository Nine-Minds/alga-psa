'use client';

import React, { useState, useEffect } from 'react';
import {
  ItilImpact,
  ItilUrgency,
  ItilLabels,
  ItilCategories,
  ItilResolutionCodes,
  calculateItilPriority
} from '../../lib/utils/itilUtils';
import CustomSelect, { SelectOption } from '../ui/CustomSelect';
import { TextArea } from '../ui/TextArea';
import { Label } from '../ui/Label';
import { Card, CardHeader, CardContent, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';

interface ItilFieldsProps {
  values: {
    itil_impact?: number;
    itil_urgency?: number;
    itil_category?: string;
    itil_subcategory?: string;
    resolution_code?: string;
    root_cause?: string;
    workaround?: string;
  };
  onChange: (field: string, value: any) => void;
  readOnly?: boolean;
  showResolutionFields?: boolean;
}

export const ItilFields: React.FC<ItilFieldsProps> = ({
  values,
  onChange,
  readOnly = false,
  showResolutionFields = false
}) => {
  const [calculatedPriority, setCalculatedPriority] = useState<number | null>(null);

  // Calculate priority when impact or urgency changes
  useEffect(() => {
    if (values.itil_impact && values.itil_urgency) {
      try {
        const priority = calculateItilPriority(values.itil_impact, values.itil_urgency);
        setCalculatedPriority(priority);
      } catch (error) {
        console.error('Error calculating ITIL priority:', error);
        setCalculatedPriority(null);
      }
    } else {
      setCalculatedPriority(null);
    }
  }, [values.itil_impact, values.itil_urgency]);

  // Convert ITIL values to select options
  const impactOptions: SelectOption[] = Object.entries(ItilLabels.impact).map(([value, label]) => ({
    value: value.toString(),
    label: `${label} (${value})`
  }));

  const urgencyOptions: SelectOption[] = Object.entries(ItilLabels.urgency).map(([value, label]) => ({
    value: value.toString(),
    label: `${label} (${value})`
  }));

  const categoryOptions: SelectOption[] = Object.keys(ItilCategories).map((category) => ({
    value: category,
    label: category
  }));

  const resolutionCodeOptions: SelectOption[] = ItilResolutionCodes.map((code) => ({
    value: code,
    label: code
  }));

  const handleImpactChange = (value: string) => {
    onChange('itil_impact', Number(value));
  };

  const handleUrgencyChange = (value: string) => {
    onChange('itil_urgency', Number(value));
  };

  const handleCategoryChange = (value: string) => {
    onChange('itil_category', value);
    // Reset subcategory when category changes
    onChange('itil_subcategory', '');
  };

  const availableSubcategories = values.itil_category
    ? ItilCategories[values.itil_category]?.subcategories || []
    : [];

  const subcategoryOptions: SelectOption[] = availableSubcategories.map((subcategory: string) => ({
    value: subcategory,
    label: subcategory
  }));

  return (
    <div className="space-y-6">
      {/* ITIL Classification Section */}
      <Card>
        <CardHeader>
          <CardTitle>ITIL Classification</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Impact */}
            <div className="space-y-2">
              <Label htmlFor="itil-impact">Impact</Label>
              <CustomSelect
                id="itil-impact"
                options={impactOptions}
                value={values.itil_impact?.toString() || null}
                onValueChange={handleImpactChange}
                disabled={readOnly}
                placeholder="Select Impact"
              />
              <p className="text-xs text-muted-foreground">
                How many users/business functions are affected?
              </p>
            </div>

            {/* Urgency */}
            <div className="space-y-2">
              <Label htmlFor="itil-urgency">Urgency</Label>
              <CustomSelect
                id="itil-urgency"
                options={urgencyOptions}
                value={values.itil_urgency?.toString() || null}
                onValueChange={handleUrgencyChange}
                disabled={readOnly}
                placeholder="Select Urgency"
              />
              <p className="text-xs text-muted-foreground">
                How quickly does this need to be resolved?
              </p>
            </div>
          </div>

          {/* Calculated Priority Display */}
          {calculatedPriority && (
            <div className="mt-4 p-3 bg-blue-50 rounded-md">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-blue-800">
                  Calculated Priority:
                </span>
                <Badge
                  className={`${
                    calculatedPriority === 1 ? 'bg-red-100 text-red-800' :
                    calculatedPriority === 2 ? 'bg-orange-100 text-orange-800' :
                    calculatedPriority === 3 ? 'bg-yellow-100 text-yellow-800' :
                    calculatedPriority === 4 ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}
                >
                  {ItilLabels.priority[calculatedPriority]} ({calculatedPriority})
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ITIL Category Section */}
      <Card>
        <CardHeader>
          <CardTitle>ITIL Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="itil-category">Category</Label>
              <CustomSelect
                id="itil-category"
                options={categoryOptions}
                value={values.itil_category || null}
                onValueChange={handleCategoryChange}
                disabled={readOnly}
                placeholder="Select Category"
              />
            </div>

            {/* Subcategory */}
            <div className="space-y-2">
              <Label htmlFor="itil-subcategory">Subcategory</Label>
              <CustomSelect
                id="itil-subcategory"
                options={subcategoryOptions}
                value={values.itil_subcategory || null}
                onValueChange={(value) => onChange('itil_subcategory', value)}
                disabled={readOnly || !values.itil_category}
                placeholder="Select Subcategory"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resolution Fields (only show when editing resolved tickets) */}
      {showResolutionFields && (
        <Card>
          <CardHeader>
            <CardTitle>Resolution Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Resolution Code */}
              <div className="space-y-2">
                <Label htmlFor="itil-resolution-code">Resolution Code</Label>
                <CustomSelect
                  id="itil-resolution-code"
                  options={resolutionCodeOptions}
                  value={values.resolution_code || null}
                  onValueChange={(value) => onChange('resolution_code', value)}
                  disabled={readOnly}
                  placeholder="Select Resolution Code"
                />
              </div>

              {/* Root Cause */}
              <div className="space-y-2">
                <Label htmlFor="itil-root-cause">Root Cause</Label>
                <TextArea
                  id="itil-root-cause"
                  value={values.root_cause || ''}
                  onChange={(e) => onChange('root_cause', e.target.value)}
                  disabled={readOnly}
                  rows={3}
                  placeholder="Describe the root cause of the incident..."
                />
              </div>

              {/* Workaround */}
              <div className="space-y-2">
                <Label htmlFor="itil-workaround">Workaround</Label>
                <TextArea
                  id="itil-workaround"
                  value={values.workaround || ''}
                  onChange={(e) => onChange('workaround', e.target.value)}
                  disabled={readOnly}
                  rows={3}
                  placeholder="Describe any temporary workarounds provided..."
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Priority Matrix Helper */}
      <Card>
        <CardHeader>
          <CardTitle>ITIL Priority Matrix Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">Impact \\ Urgency</TableHead>
                  {Object.entries(ItilLabels.urgency).map(([value, label]) => (
                    <TableHead key={value} className="text-center text-xs">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(ItilLabels.impact).map(([impactValue, impactLabel]) => (
                  <TableRow key={impactValue}>
                    <TableCell className="text-xs font-medium">
                      {impactLabel}
                    </TableCell>
                    {Object.entries(ItilLabels.urgency).map(([urgencyValue]) => {
                      const priority = calculateItilPriority(Number(impactValue), Number(urgencyValue));
                      const priorityLabel = ItilLabels.priority[priority];
                      return (
                        <TableCell key={urgencyValue} className="text-center">
                          <Badge
                            className={`${
                              priority === 1 ? 'bg-red-100 text-red-800' :
                              priority === 2 ? 'bg-orange-100 text-orange-800' :
                              priority === 3 ? 'bg-yellow-100 text-yellow-800' :
                              priority === 4 ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {priorityLabel}
                          </Badge>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            <p><strong>Impact:</strong> Number of users/business functions affected</p>
            <p><strong>Urgency:</strong> How quickly the incident needs to be resolved</p>
            <p><strong>Priority:</strong> Automatically calculated based on Impact × Urgency matrix</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};