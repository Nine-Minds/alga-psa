'use client';

import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { IProblem } from '../../interfaces/problem.interfaces';

const problemRecordSchema = z.object({
  problem_summary: z.string().min(10, 'Summary must be at least 10 characters'),
  problem_description: z.string().min(50, 'Description must be at least 50 characters'),
  problem_type: z.enum(['reactive', 'proactive']),
  problem_category: z.string().min(1, 'Category is required'),
  problem_subcategory: z.string().optional(),
  priority: z.number().min(1).max(5),
  business_impact: z.enum(['low', 'medium', 'high', 'critical']),
  affected_services: z.array(z.string()).min(1, 'At least one affected service is required'),
  symptom_description: z.string().min(20, 'Symptom description is required'),
  error_messages: z.string().optional(),
  frequency: z.enum(['once', 'rarely', 'occasionally', 'frequently', 'constantly']),
  trend_analysis: z.string().optional(),
  root_cause: z.string().optional(),
  resolution_actions: z.string().optional(),
  preventive_actions: z.string().optional(),
  kedb_article_title: z.string().optional(),
  kedb_symptoms: z.string().optional(),
  kedb_resolution: z.string().optional(),
  related_incident_ids: z.array(z.string()).optional()
});

type ProblemRecordFormData = z.infer<typeof problemRecordSchema>;

interface ProblemRecordFormProps {
  initialData?: Partial<IProblem>;
  onSubmit: (data: ProblemRecordFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  loading?: boolean;
}

export function ProblemRecordForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  loading = false
}: ProblemRecordFormProps) {
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [relatedIncidents, setRelatedIncidents] = useState<any[]>([]);
  const [problemCategories] = useState<string[]>([
    'Hardware',
    'Software',
    'Network',
    'Database',
    'Security',
    'Performance',
    'User Access',
    'Integration',
    'Other'
  ]);
  const [showKEDBFields, setShowKEDBFields] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
    setValue,
    getValues
  } = useForm<ProblemRecordFormData>({
    resolver: zodResolver(problemRecordSchema),
    defaultValues: {
      problem_type: 'reactive',
      priority: 3,
      business_impact: 'medium',
      frequency: 'occasionally',
      affected_services: [],
      related_incident_ids: []
    }
  });

  const watchedCategory = watch('problem_category');
  const watchedType = watch('problem_type');
  const watchedStatus = watch('problem_status');

  useEffect(() => {
    // Load available services
    fetchAvailableServices();
  }, []);

  useEffect(() => {
    // Show KEDB fields when problem is resolved
    setShowKEDBFields(watchedStatus === 'resolved');
  }, [watchedStatus]);

  const fetchAvailableServices = async () => {
    try {
      const response = await fetch('/api/services');
      const services = await response.json();
      setAvailableServices(services.map((s: any) => s.service_name));
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  const fetchRelatedIncidents = async (keywords: string) => {
    if (!keywords || keywords.length < 3) return;
    
    try {
      const response = await fetch(`/api/tickets/search?q=${encodeURIComponent(keywords)}&type=incident`);
      const incidents = await response.json();
      setRelatedIncidents(incidents);
    } catch (error) {
      console.error('Error fetching related incidents:', error);
    }
  };

  const onFormSubmit = async (data: ProblemRecordFormData) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error('Error submitting problem record:', error);
    }
  };

  const getSubcategoriesForCategory = (category: string): string[] => {
    const subcategories: { [key: string]: string[] } = {
      'Hardware': ['Server', 'Workstation', 'Network Equipment', 'Storage', 'Peripherals'],
      'Software': ['Application', 'Operating System', 'Database', 'Middleware', 'Driver'],
      'Network': ['Connectivity', 'Performance', 'Security', 'DNS', 'DHCP'],
      'Database': ['Performance', 'Corruption', 'Access', 'Backup', 'Replication'],
      'Security': ['Access Control', 'Malware', 'Vulnerability', 'Policy Violation', 'Breach'],
      'Performance': ['Response Time', 'Throughput', 'Resource Usage', 'Scalability', 'Bottleneck'],
      'User Access': ['Authentication', 'Authorization', 'Account Management', 'Password', 'Permissions'],
      'Integration': ['API', 'Data Transfer', 'Synchronization', 'Format', 'Protocol']
    };
    
    return subcategories[category] || [];
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white shadow-lg rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? 'Edit Problem Record' : 'Create New Problem Record'}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Document and track problems to identify root causes and prevent recurring incidents.
          </p>
        </div>

        <form onSubmit={handleSubmit(onFormSubmit)} className="p-6 space-y-6">
          {/* Basic Information */}
          <div className="border rounded-lg p-4">
            <h3 className="text-lg font-medium mb-4">Basic Information</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Problem Summary *
                </label>
                <input
                  {...register('problem_summary')}
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief summary of the problem"
                />
                {errors.problem_summary && (
                  <p className="mt-1 text-sm text-red-600">{errors.problem_summary.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Problem Type *
                </label>
                <Controller
                  name="problem_type"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="reactive">Reactive - Triggered by incidents</option>
                      <option value="proactive">Proactive - Identified through monitoring</option>
                    </select>
                  )}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Problem Description *
              </label>
              <textarea
                {...register('problem_description')}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Detailed description of the problem, including when it occurs, what triggers it, and its effects"
              />
              {errors.problem_description && (
                <p className="mt-1 text-sm text-red-600">{errors.problem_description.message}</p>
              )}
            </div>
          </div>

          {/* Classification */}
          <div className="border rounded-lg p-4">
            <h3 className="text-lg font-medium mb-4">Classification</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category *
                </label>
                <Controller
                  name="problem_category"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Category</option>
                      {problemCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  )}
                />
                {errors.problem_category && (
                  <p className="mt-1 text-sm text-red-600">{errors.problem_category.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Subcategory
                </label>
                <Controller
                  name="problem_subcategory"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      disabled={!watchedCategory}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="">Select Subcategory</option>
                      {watchedCategory && getSubcategoriesForCategory(watchedCategory).map((sub) => (
                        <option key={sub} value={sub}>
                          {sub}
                        </option>
                      ))}
                    </select>
                  )}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Priority *
                </label>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1}>1 - Critical</option>
                      <option value={2}>2 - High</option>
                      <option value={3}>3 - Medium</option>
                      <option value={4}>4 - Low</option>
                      <option value={5}>5 - Planning</option>
                    </select>
                  )}
                />
              </div>
            </div>
          </div>

          {/* Impact Analysis */}
          <div className="border rounded-lg p-4">
            <h3 className="text-lg font-medium mb-4">Impact Analysis</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Business Impact *
                </label>
                <Controller
                  name="business_impact"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="low">Low - Minimal business impact</option>
                      <option value="medium">Medium - Moderate business impact</option>
                      <option value="high">High - Significant business impact</option>
                      <option value="critical">Critical - Severe business impact</option>
                    </select>
                  )}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Frequency *
                </label>
                <Controller
                  name="frequency"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="once">Once - Single occurrence</option>
                      <option value="rarely">Rarely - Few times per year</option>
                      <option value="occasionally">Occasionally - Monthly</option>
                      <option value="frequently">Frequently - Weekly</option>
                      <option value="constantly">Constantly - Daily or continuous</option>
                    </select>
                  )}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Affected Services *
              </label>
              <Controller
                name="affected_services"
                control={control}
                render={({ field: { onChange, value } }) => (
                  <div className="space-y-2">
                    {availableServices && availableServices.map((service) => (
                      <label key={service} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={value?.includes(service) || false}
                          onChange={(e) => {
                            const newValue = e.target.checked
                              ? [...(value || []), service]
                              : (value || []).filter(s => s !== service);
                            onChange(newValue);
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-700">{service}</span>
                      </label>
                    ))}
                  </div>
                )}
              />
              {errors.affected_services && (
                <p className="mt-1 text-sm text-red-600">{errors.affected_services.message}</p>
              )}
            </div>
          </div>

          {/* Symptoms & Error Details */}
          <div className="border rounded-lg p-4">
            <h3 className="text-lg font-medium mb-4">Symptoms & Error Details</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Symptom Description *
                </label>
                <textarea
                  {...register('symptom_description')}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe the symptoms that users experience when this problem occurs"
                />
                {errors.symptom_description && (
                  <p className="mt-1 text-sm text-red-600">{errors.symptom_description.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Error Messages
                </label>
                <textarea
                  {...register('error_messages')}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Copy any specific error messages or codes that appear"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Trend Analysis
                </label>
                <textarea
                  {...register('trend_analysis')}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe any patterns, trends, or conditions that correlate with this problem"
                />
              </div>
            </div>
          </div>

          {/* Resolution Information (for resolved problems) */}
          {showKEDBFields && (
            <div className="border rounded-lg p-4">
              <h3 className="text-lg font-medium mb-4">Resolution & Knowledge Base</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Root Cause
                  </label>
                  <textarea
                    {...register('root_cause')}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe the underlying root cause of this problem"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Resolution Actions
                  </label>
                  <textarea
                    {...register('resolution_actions')}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe the actions taken to resolve this problem"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Preventive Actions
                  </label>
                  <textarea
                    {...register('preventive_actions')}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe actions to prevent this problem from recurring"
                  />
                </div>

                {/* KEDB Article Creation */}
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <h4 className="text-md font-medium text-blue-800 mb-3">Create Knowledge Base Article</h4>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-1">
                        Article Title
                      </label>
                      <input
                        {...register('kedb_article_title')}
                        type="text"
                        className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Title for the knowledge base article"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-1">
                        KEDB Symptoms
                      </label>
                      <textarea
                        {...register('kedb_symptoms')}
                        rows={2}
                        className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Symptoms that help identify this problem"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-1">
                        KEDB Resolution
                      </label>
                      <textarea
                        {...register('kedb_resolution')}
                        rows={3}
                        className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Step-by-step resolution instructions for this problem"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? 'Saving...' : isEditing ? 'Update Problem' : 'Create Problem'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}