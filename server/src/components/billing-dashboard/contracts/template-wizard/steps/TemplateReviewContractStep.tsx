'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { TemplateWizardData } from '../TemplateWizard';
import { Badge } from 'server/src/components/ui/Badge';
import { getCurrencySymbol, CURRENCY_OPTIONS } from 'server/src/constants/currency';

interface TemplateReviewContractStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateReviewContractStep({
  data,
}: TemplateReviewContractStepProps) {
  const currencySymbol = getCurrencySymbol(data.currency_code);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Review Template</h3>
      <p className="text-sm text-gray-600">
        Confirm the template contents. You can publish now or go back to make adjustments.
      </p>

      <div className="max-h-[420px] overflow-y-auto pr-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Template Name</span>
                <span className="font-medium text-gray-900">{data.contract_name || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Billing Frequency</span>
                <span className="font-medium text-gray-900">
                  {data.billing_frequency ? data.billing_frequency.replace(/_/g, ' ') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Currency</span>
                <span className="font-medium text-gray-900">
                  {CURRENCY_OPTIONS.find((opt) => opt.value === data.currency_code)?.label ||
                    data.currency_code ||
                    '—'}
                </span>
              </div>
              <div>
                <span className="text-gray-600 block mb-1">Internal Notes</span>
                <p className="text-gray-900">
                  {data.description?.trim() ? data.description : 'No notes added.'}
                </p>
              </div>
            </CardContent>
          </Card>

          {data.fixed_services.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Fixed Fee Services
                  <Badge variant="outline">{data.fixed_services.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.fixed_base_rate !== undefined && (
                  <div className="pb-3 mb-3 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Recurring Base Rate</span>
                      <span className="font-semibold text-gray-900">{currencySymbol}{(data.fixed_base_rate / 100).toFixed(2)}</span>
                    </div>
                    {data.enable_proration && (
                      <div className="text-xs text-gray-600 mt-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                          Proration enabled
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {data.fixed_services.map((service, index) => (
                  <div key={`${service.service_id}-${index}`} className="border border-gray-200 rounded-md p-3 bg-gray-50">
                    <p className="font-medium text-gray-900">
                      {service.service_name || 'Unnamed Service'}
                    </p>
                    <div className="text-xs text-gray-600 flex flex-wrap gap-3 mt-2">
                      <span>Quantity Guidance: {service.quantity ?? 1}</span>
                      {service.bucket_overlay && (
                        <span>
                          Bucket: {service.bucket_overlay.total_minutes ?? 0} minutes · Overage {currencySymbol}
                          {((service.bucket_overlay.overage_rate ?? 0) / 100).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {data.hourly_services.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Hourly Services
                  <Badge variant="outline">{data.hourly_services.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="text-xs text-gray-600 flex flex-wrap gap-3 mb-2">
                  <span>Minimum billable time: {data.minimum_billable_time ?? 0} minutes</span>
                  <span>Round up: {data.round_up_to_nearest ?? 0} minutes</span>
                </div>
                {data.hourly_services.map((service, index) => (
                  <div key={`${service.service_id}-${index}`} className="border border-gray-200 rounded-md p-3 bg-gray-50">
                    <p className="font-medium text-gray-900">
                      {service.service_name || 'Unnamed Service'}
                    </p>
                    <div className="text-xs text-gray-600 flex flex-wrap gap-3 mt-2">
                      {service.hourly_rate !== undefined && (
                        <span>Suggested Rate: {currencySymbol}{(service.hourly_rate / 100).toFixed(2)}/hr</span>
                      )}
                      {service.bucket_overlay && (
                        <span>
                          Bucket: {((service.bucket_overlay.total_minutes ?? 0) / 60).toFixed(2)} hours · Overage {currencySymbol}
                          {((service.bucket_overlay.overage_rate ?? 0) / 100).toFixed(2)}/hr
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {(data.usage_services?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Usage-Based Services
                  <Badge variant="outline">{data.usage_services?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.usage_services?.map((service, index) => (
                  <div key={`${service.service_id}-${index}`} className="border border-gray-200 rounded-md p-3 bg-gray-50">
                    <p className="font-medium text-gray-900">
                      {service.service_name || 'Unnamed Service'}
                    </p>
                    <div className="text-xs text-gray-600 flex flex-wrap gap-3 mt-2">
                      <span>Unit: {service.unit_of_measure || 'Not specified'}</span>
                      {service.unit_rate !== undefined && (
                        <span>Suggested Rate: {currencySymbol}{(service.unit_rate / 100).toFixed(2)}/{service.unit_of_measure || 'unit'}</span>
                      )}
                      {service.bucket_overlay && (
                        <span>
                          Bucket: {service.bucket_overlay.total_minutes ?? 0} units · Overage {currencySymbol}
                          {((service.bucket_overlay.overage_rate ?? 0) / 100).toFixed(2)}/unit
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
      </div>
    </div>
  );
}
