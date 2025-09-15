'use client'

import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { IChangeRequest } from '../../interfaces/change.interfaces';

const changeRequestSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  description: z.string().min(20, 'Description must be at least 20 characters'),
  change_type: z.enum(['standard', 'normal', 'emergency']),
  change_category: z.string().min(1, 'Category is required'),
  priority: z.number().min(1).max(5),
  business_justification: z.string().min(10, 'Business justification is required'),
  business_impact: z.enum(['low', 'medium', 'high']),
  technical_impact: z.enum(['low', 'medium', 'high']),
  affected_services: z.array(z.string()).min(1, 'At least one affected service is required'),
  estimated_duration: z.number().min(0.5, 'Duration must be at least 30 minutes'),
  implementation_plan: z.string().min(50, 'Implementation plan must be detailed'),
  rollback_plan: z.string().min(30, 'Rollback plan is required'),
  testing_plan: z.string().optional(),
  requested_date: z.string().optional(),
  emergency_justification: z.string().optional(),
  dependencies: z.array(z.string()).optional()
});

type ChangeRequestFormData = z.infer<typeof changeRequestSchema>;

interface ChangeRequestFormProps {
  initialData?: Partial<IChangeRequest>;
  onSubmit: (data: ChangeRequestFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  loading?: boolean;
}

export function ChangeRequestForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  loading = false
}: ChangeRequestFormProps) {
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [changeCategories, setChangeCategories] = useState<string[]>([]);
  const [riskAssessment, setRiskAssessment] = useState<any>(null);
  const [showEmergencyFields, setShowEmergencyFields] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<ChangeRequestFormData>({
    resolver: zodResolver(changeRequestSchema),
    defaultValues: {
      change_type: (initialData?.change_type as 'standard' | 'normal' | 'emergency') || 'normal',
      priority: (initialData as any)?.priority || 3,
      business_impact: (['low', 'medium', 'high'].includes((initialData as any)?.business_impact) ? (initialData as any)?.business_impact : 'medium') as 'low' | 'medium' | 'high',
      technical_impact: (['low', 'medium', 'high'].includes((initialData as any)?.technical_impact) ? (initialData as any)?.technical_impact : 'medium') as 'low' | 'medium' | 'high',
      estimated_duration: (initialData as any)?.estimated_duration || 2,
      affected_services: (initialData as any)?.affected_services || [],
      dependencies: (initialData as any)?.dependencies || [],
      ...initialData
    }
  });

  const watchedChangeType = watch('change_type');
  const watchedBusinessImpact = watch('business_impact');
  const watchedTechnicalImpact = watch('technical_impact');
  const watchedAffectedServices = watch('affected_services');

  useEffect(() => {
    setShowEmergencyFields(watchedChangeType === 'emergency');
  }, [watchedChangeType]);

  useEffect(() => {
    // Load available services and categories
    loadFormData();
  }, []);

  useEffect(() => {
    // Perform automatic risk assessment when relevant fields change
    if (watchedBusinessImpact && watchedTechnicalImpact && watchedAffectedServices?.length > 0) {
      performRiskAssessment();
    }
  }, [watchedBusinessImpact, watchedTechnicalImpact, watchedAffectedServices]);

  const loadFormData = async () => {
    try {
      // In real implementation, these would be API calls
      setAvailableServices([
        'Email Service',
        'Web Application',
        'Database',
        'Network Infrastructure',
        'Authentication Service',
        'Backup System',
        'Monitoring System'
      ]);

      setChangeCategories([
        'Infrastructure',
        'Application',
        'Security',
        'Network',
        'Database',
        'Hardware',
        'Software',
        'Process'
      ]);
    } catch (error) {
      console.error('Error loading form data:', error);
    }
  };

  const performRiskAssessment = async () => {
    try {
      const formData = watch();
      
      // Simplified risk assessment logic
      const technicalRisk = calculateTechnicalRisk(formData);
      const businessRisk = calculateBusinessRisk(formData);
      const overallRisk = calculateOverallRisk(technicalRisk, businessRisk) as 'low' | 'medium' | 'high';

      const assessment = {
        technicalRisk,
        businessRisk,
        overallRisk
      };
      setRiskAssessment(assessment);
      
      // Auto-update priority based on risk
      const suggestedPriority = getSuggestedPriority(assessment.overallRisk);
      setValue('priority', suggestedPriority);
    } catch (error) {
      console.error('Error performing risk assessment:', error);
    }
  };

  const calculateTechnicalRisk = (data: Partial<ChangeRequestFormData>): 'low' | 'medium' | 'high' => {
    let riskScore = 0;
    
    if (data.technical_impact === 'high') riskScore += 3;
    else if (data.technical_impact === 'medium') riskScore += 2;
    else riskScore += 1;
    
    if (data.estimated_duration && data.estimated_duration > 8) riskScore += 2;
    else if (data.estimated_duration && data.estimated_duration > 4) riskScore += 1;
    
    if (data.affected_services && data.affected_services.length > 3) riskScore += 2;
    else if (data.affected_services && data.affected_services.length > 1) riskScore += 1;
    
    if (riskScore >= 6) return 'high';
    if (riskScore >= 4) return 'medium';
    return 'low';
  };

  const calculateBusinessRisk = (data: Partial<ChangeRequestFormData>): 'low' | 'medium' | 'high' => {
    if (data.business_impact === 'high') return 'high';
    if (data.business_impact === 'medium') return 'medium';
    return 'low';
  };

  const calculateOverallRisk = (technical: string, business: string): 'low' | 'medium' | 'high' => {
    if (technical === 'high' || business === 'high') return 'high';
    if (technical === 'medium' || business === 'medium') return 'medium';
    return 'low';
  };

  const getSuggestedPriority = (risk: string): number => {
    switch (risk) {
      case 'high': return 1;
      case 'medium': return 2;
      default: return 3;
    }
  };

  const handleFormSubmit = async (data: ChangeRequestFormData) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error('Error submitting change request:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          {isEditing ? 'Edit Change Request' : 'Create Change Request'}
        </h2>
        <p className="text-gray-600 mt-1">
          Complete this form to submit a change request for review and approval
        </p>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit as any)} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Controller
              name="title"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Change Title *
                  </label>
                  <input
                    {...field}
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Brief description of the change"
                  />
                  {errors.title && (
                    <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>
                  )}
                </div>
              )}
            />

            <Controller
              name="change_type"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Change Type *
                  </label>
                  <select
                    {...field}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="standard">Standard Change</option>
                    <option value="normal">Normal Change</option>
                    <option value="emergency">Emergency Change</option>
                  </select>
                  {errors.change_type && (
                    <p className="text-red-500 text-sm mt-1">{errors.change_type.message}</p>
                  )}
                </div>
              )}
            />

            <Controller
              name="change_category"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category *
                  </label>
                  <select
                    {...field}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Category</option>
                    {changeCategories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  {errors.change_category && (
                    <p className="text-red-500 text-sm mt-1">{errors.change_category.message}</p>
                  )}
                </div>
              )}
            />

            <Controller
              name="priority"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority *
                  </label>
                  <select
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={1}>1 - Critical</option>
                    <option value={2}>2 - High</option>
                    <option value={3}>3 - Medium</option>
                    <option value={4}>4 - Low</option>
                    <option value={5}>5 - Planning</option>
                  </select>
                  {errors.priority && (
                    <p className="text-red-500 text-sm mt-1">{errors.priority.message}</p>
                  )}
                </div>
              )}
            />
          </div>

          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Change Description *
                </label>
                <textarea
                  {...field}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Detailed description of the change, what will be modified, and expected outcomes"
                />
                {errors.description && (
                  <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>
                )}
              </div>
            )}
          />
        </div>

        {/* Impact Assessment */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Impact Assessment</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Controller
              name="business_impact"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Business Impact *
                  </label>
                  <select
                    {...field}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  {errors.business_impact && (
                    <p className="text-red-500 text-sm mt-1">{errors.business_impact.message}</p>
                  )}
                </div>
              )}
            />

            <Controller
              name="technical_impact"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Technical Impact *
                  </label>
                  <select
                    {...field}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  {errors.technical_impact && (
                    <p className="text-red-500 text-sm mt-1">{errors.technical_impact.message}</p>
                  )}
                </div>
              )}
            />

            <Controller
              name="estimated_duration"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Estimated Duration (hours) *
                  </label>
                  <input
                    {...field}
                    type="number"
                    step="0.5"
                    min="0.5"
                    onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {errors.estimated_duration && (
                    <p className="text-red-500 text-sm mt-1">{errors.estimated_duration.message}</p>
                  )}
                </div>
              )}
            />
          </div>

          <Controller
            name="affected_services"
            control={control}
            render={({ field }) => (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Affected Services *
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {availableServices.map(service => (
                    <label key={service} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={field.value?.includes(service) || false}
                        onChange={(e) => {
                          const currentValue = field.value || [];
                          if (e.target.checked) {
                            field.onChange([...currentValue, service]);
                          } else {
                            field.onChange(currentValue.filter(s => s !== service));
                          }
                        }}
                        className="mr-2"
                      />
                      <span className="text-sm">{service}</span>
                    </label>
                  ))}
                </div>
                {errors.affected_services && (
                  <p className="text-red-500 text-sm mt-1">{errors.affected_services.message}</p>
                )}
              </div>
            )}
          />

          {riskAssessment && (
            <div className="mt-4 p-3 bg-blue-50 rounded-md">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Risk Assessment</h4>
              <div className="text-sm text-blue-800">
                <p>Technical Risk: <span className="font-medium">{riskAssessment.technicalRisk}</span></p>
                <p>Business Risk: <span className="font-medium">{riskAssessment.businessRisk}</span></p>
                <p>Overall Risk: <span className="font-medium">{riskAssessment.overallRisk}</span></p>
              </div>
            </div>
          )}
        </div>

        {/* Justification */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Business Justification</h3>
          
          <Controller
            name="business_justification"
            control={control}
            render={({ field }) => (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business Justification *
                </label>
                <textarea
                  {...field}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Explain why this change is necessary and the business benefits it will provide"
                />
                {errors.business_justification && (
                  <p className="text-red-500 text-sm mt-1">{errors.business_justification.message}</p>
                )}
              </div>
            )}
          />

          {showEmergencyFields && (
            <Controller
              name="emergency_justification"
              control={control}
              render={({ field }) => (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Emergency Justification *
                  </label>
                  <textarea
                    {...field}
                    rows={3}
                    className="w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Explain why this change requires emergency processing and cannot wait for normal approval"
                  />
                  {errors.emergency_justification && (
                    <p className="text-red-500 text-sm mt-1">{errors.emergency_justification.message}</p>
                  )}
                </div>
              )}
            />
          )}
        </div>

        {/* Implementation Plans */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Implementation Plans</h3>
          
          <div className="space-y-4">
            <Controller
              name="implementation_plan"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Implementation Plan *
                  </label>
                  <textarea
                    {...field}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Detailed step-by-step plan for implementing this change"
                  />
                  {errors.implementation_plan && (
                    <p className="text-red-500 text-sm mt-1">{errors.implementation_plan.message}</p>
                  )}
                </div>
              )}
            />

            <Controller
              name="rollback_plan"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rollback Plan *
                  </label>
                  <textarea
                    {...field}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Detailed plan for rolling back the change if implementation fails"
                  />
                  {errors.rollback_plan && (
                    <p className="text-red-500 text-sm mt-1">{errors.rollback_plan.message}</p>
                  )}
                </div>
              )}
            />

            <Controller
              name="testing_plan"
              control={control}
              render={({ field }) => (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Testing Plan
                  </label>
                  <textarea
                    {...field}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Plan for testing the change before and after implementation"
                  />
                  {errors.testing_plan && (
                    <p className="text-red-500 text-sm mt-1">{errors.testing_plan.message}</p>
                  )}
                </div>
              )}
            />
          </div>
        </div>

        {/* Scheduling */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Scheduling</h3>
          
          <Controller
            name="requested_date"
            control={control}
            render={({ field }) => (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Requested Implementation Date
                </label>
                <input
                  {...field}
                  type="datetime-local"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.requested_date && (
                  <p className="text-red-500 text-sm mt-1">{errors.requested_date.message}</p>
                )}
              </div>
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-4 pt-6 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
            disabled={isSubmitting || loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            disabled={isSubmitting || loading}
          >
            {isSubmitting || loading ? 'Submitting...' : (isEditing ? 'Update Change Request' : 'Submit Change Request')}
          </button>
        </div>
      </form>
    </div>
  );
}