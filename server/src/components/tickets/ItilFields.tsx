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

  const handleImpactChange = (impact: number) => {
    onChange('itil_impact', impact);
  };

  const handleUrgencyChange = (urgency: number) => {
    onChange('itil_urgency', urgency);
  };

  const handleCategoryChange = (category: string) => {
    onChange('itil_category', category);
    // Reset subcategory when category changes
    onChange('itil_subcategory', '');
  };

  const availableSubcategories = values.itil_category 
    ? ItilCategories[values.itil_category]?.subcategories || []
    : [];

  return (
    <div className="space-y-6">
      {/* ITIL Classification Section */}
      <div className="border rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-4">ITIL Classification</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Impact */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Impact
            </label>
            <select
              value={values.itil_impact || ''}
              onChange={(e) => handleImpactChange(Number(e.target.value))}
              disabled={readOnly}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select Impact</option>
              {Object.entries(ItilLabels.impact).map(([value, label]) => (
                <option key={value} value={value}>
                  {label} ({value})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              How many users/business functions are affected?
            </p>
          </div>

          {/* Urgency */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Urgency
            </label>
            <select
              value={values.itil_urgency || ''}
              onChange={(e) => handleUrgencyChange(Number(e.target.value))}
              disabled={readOnly}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select Urgency</option>
              {Object.entries(ItilLabels.urgency).map(([value, label]) => (
                <option key={value} value={value}>
                  {label} ({value})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
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
              <span className={`px-2 py-1 rounded text-sm font-semibold ${
                calculatedPriority === 1 ? 'bg-red-100 text-red-800' :
                calculatedPriority === 2 ? 'bg-orange-100 text-orange-800' :
                calculatedPriority === 3 ? 'bg-yellow-100 text-yellow-800' :
                calculatedPriority === 4 ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {ItilLabels.priority[calculatedPriority]} ({calculatedPriority})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ITIL Category Section */}
      <div className="border rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-4">ITIL Category</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category
            </label>
            <select
              value={values.itil_category || ''}
              onChange={(e) => handleCategoryChange(e.target.value)}
              disabled={readOnly}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select Category</option>
              {Object.keys(ItilCategories).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          {/* Subcategory */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Subcategory
            </label>
            <select
              value={values.itil_subcategory || ''}
              onChange={(e) => onChange('itil_subcategory', e.target.value)}
              disabled={readOnly || !values.itil_category}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select Subcategory</option>
              {availableSubcategories.map((subcategory) => (
                <option key={subcategory} value={subcategory}>
                  {subcategory}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Resolution Fields (only show when editing resolved tickets) */}
      {showResolutionFields && (
        <div className="border rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-4">Resolution Details</h3>
          
          <div className="space-y-4">
            {/* Resolution Code */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Resolution Code
              </label>
              <select
                value={values.resolution_code || ''}
                onChange={(e) => onChange('resolution_code', e.target.value)}
                disabled={readOnly}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select Resolution Code</option>
                {ItilResolutionCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>

            {/* Root Cause */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Root Cause
              </label>
              <textarea
                value={values.root_cause || ''}
                onChange={(e) => onChange('root_cause', e.target.value)}
                disabled={readOnly}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                placeholder="Describe the root cause of the incident..."
              />
            </div>

            {/* Workaround */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Workaround
              </label>
              <textarea
                value={values.workaround || ''}
                onChange={(e) => onChange('workaround', e.target.value)}
                disabled={readOnly}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                placeholder="Describe any temporary workarounds provided..."
              />
            </div>
          </div>
        </div>
      )}

      {/* Priority Matrix Helper */}
      <div className="border rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-4">ITIL Priority Matrix Reference</h3>
        
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-300 px-3 py-2 text-left">Impact \\ Urgency</th>
                {Object.entries(ItilLabels.urgency).map(([value, label]) => (
                  <th key={value} className="border border-gray-300 px-3 py-2 text-center text-xs">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(ItilLabels.impact).map(([impactValue, impactLabel]) => (
                <tr key={impactValue}>
                  <td className="border border-gray-300 px-3 py-2 text-xs font-medium">
                    {impactLabel}
                  </td>
                  {Object.entries(ItilLabels.urgency).map(([urgencyValue]) => {
                    const priority = calculateItilPriority(Number(impactValue), Number(urgencyValue));
                    const priorityLabel = ItilLabels.priority[priority];
                    return (
                      <td key={urgencyValue} className="border border-gray-300 px-3 py-2 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          priority === 1 ? 'bg-red-100 text-red-800' :
                          priority === 2 ? 'bg-orange-100 text-orange-800' :
                          priority === 3 ? 'bg-yellow-100 text-yellow-800' :
                          priority === 4 ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {priorityLabel}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="mt-3 text-xs text-gray-600">
          <p><strong>Impact:</strong> Number of users/business functions affected</p>
          <p><strong>Urgency:</strong> How quickly the incident needs to be resolved</p>
          <p><strong>Priority:</strong> Automatically calculated based on Impact × Urgency matrix</p>
        </div>
      </div>
    </div>
  );
};