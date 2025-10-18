'use client';

import React from 'react';
import { ContractWizardData, BucketOverlayInput } from '../ContractWizard';
import { Card } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { FileText, Repeat, Package, Clock, Activity, CheckCircle2 } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';

interface ReviewContractStepProps {
  data: ContractWizardData;
}

function formatOverlaySummary(
  overlay: BucketOverlayInput | null | undefined,
  mode: 'hours' | 'usage',
  unitLabel?: string
): string | null {
  if (!overlay || overlay.total_minutes == null) {
    return null;
  }

  const included =
    mode === 'hours'
      ? overlay.total_minutes / 60
      : overlay.total_minutes;

  const formattedIncluded =
    mode === 'hours'
      ? `${included.toLocaleString(undefined, { maximumFractionDigits: 2 })} hours`
      : `${included.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unitLabel || 'units'}`;

  const overage =
    overlay.overage_rate != null
      ? `Overage: ${overlay.overage_rate}/ ${mode === 'hours' ? 'hour' : unitLabel || 'unit'}`
      : null;

  const rollover = overlay.allow_rollover ? 'rollover enabled' : 'no rollover';

  return `${formattedIncluded}${overage ? `, ${overage}` : ''}, ${rollover}`;
}

export function ReviewContractStep({ data }: ReviewContractStepProps) {
  const hasFixedServices = data.fixed_services.length > 0;
  const hasHourlyServices = data.hourly_services.length > 0;
  const hasUsageServices = Boolean(data.usage_services && data.usage_services.length > 0);

  return (
    <div className="space-y-6" data-automation-id="contract-template-review-step">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Review Template</h3>
        <p className="text-sm text-gray-600">
          Confirm the template details below. You can go back to make adjustments before publishing.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <h4 className="font-semibold">Template Basics</h4>
        </div>
        <div className="flex flex-col gap-3 text-sm text-gray-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-blue-500" />
            <span>
              <strong>Name:</strong> {data.contract_name || 'Not specified'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-blue-500" />
            <span>
              <strong>Recommended cadence:</strong>{' '}
              {BILLING_FREQUENCY_OPTIONS.find((opt) => opt.value === data.billing_frequency)?.label ||
                data.billing_frequency ||
                'Not specified'}
            </span>
          </div>
          {data.description && (
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 text-blue-500" />
              <span className="whitespace-pre-wrap">
                <strong>Notes:</strong> {data.description}
              </span>
            </div>
          )}
        </div>
      </Card>

      {hasFixedServices && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-green-600" />
              <h4 className="font-semibold">Fixed Fee Services</h4>
            </div>
            <Badge variant="secondary">{data.fixed_services.length} service(s)</Badge>
          </div>
          <ul className="space-y-2 text-sm text-gray-700">
            {data.fixed_services.map((service, idx) => (
              <li key={`${service.service_id}-${idx}`} className="border border-gray-200 rounded-md p-3 bg-gray-50">
                <p className="font-medium">
                  {service.service_name || `Service ${idx + 1}`}
                  {service.quantity ? ` × ${service.quantity}` : ''}
                </p>
                {formatOverlaySummary(service.bucket_overlay, 'hours') && (
                  <p className="text-xs text-blue-700 mt-1">
                    Bucket guidance: {formatOverlaySummary(service.bucket_overlay, 'hours')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {hasHourlyServices && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-purple-600" />
              <h4 className="font-semibold">Hourly Services</h4>
            </div>
            <Badge variant="secondary">{data.hourly_services.length} service(s)</Badge>
          </div>
          <div className="space-y-2 text-sm text-gray-700">
            {data.minimum_billable_time && (
              <p>
                <strong>Minimum billable time:</strong> {data.minimum_billable_time} minutes
              </p>
            )}
            {data.round_up_to_nearest && (
              <p>
                <strong>Round up to nearest:</strong> {data.round_up_to_nearest} minutes
              </p>
            )}
          </div>
          <ul className="space-y-2 text-sm text-gray-700">
            {data.hourly_services.map((service, idx) => (
              <li key={`${service.service_id}-${idx}`} className="border border-gray-200 rounded-md p-3 bg-gray-50">
                <p className="font-medium">{service.service_name || `Service ${idx + 1}`}</p>
                {formatOverlaySummary(service.bucket_overlay, 'hours') && (
                  <p className="text-xs text-purple-700 mt-1">
                    Bucket guidance: {formatOverlaySummary(service.bucket_overlay, 'hours')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {hasUsageServices && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-orange-600" />
              <h4 className="font-semibold">Usage-Based Services</h4>
            </div>
            <Badge variant="secondary">{data.usage_services?.length ?? 0} service(s)</Badge>
          </div>
          <ul className="space-y-2 text-sm text-gray-700">
            {data.usage_services?.map((service, idx) => (
              <li key={`${service.service_id}-${idx}`} className="border border-gray-200 rounded-md p-3 bg-gray-50">
                <p className="font-medium">{service.service_name || `Service ${idx + 1}`}</p>
                <p className="text-xs text-gray-600">
                  Unit of measure: {service.unit_of_measure || 'unit'}
                </p>
                {formatOverlaySummary(service.bucket_overlay, 'usage', service.unit_of_measure) && (
                  <p className="text-xs text-orange-700 mt-1">
                    Bucket guidance: {formatOverlaySummary(service.bucket_overlay, 'usage', service.unit_of_measure)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!hasFixedServices && !hasHourlyServices && !hasUsageServices && (
        <Card className="p-4 text-sm text-gray-600 bg-gray-50 border border-gray-200">
          No services have been added yet. Return to previous steps to add fixed, hourly, or usage items.
        </Card>
      )}
    </div>
  );
}
