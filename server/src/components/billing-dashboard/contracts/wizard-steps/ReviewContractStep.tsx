'use client';

import React, { useState, useEffect } from 'react';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { Card } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { Building2, FileText, Calendar, DollarSign, Clock, Package, Activity, CheckCircle2, FileCheck, Repeat } from 'lucide-react';
import { parse } from 'date-fns';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { getClients } from 'server/src/lib/actions/clientAction';

interface ReviewContractStepProps {
  data: ContractWizardData;
}

export function ReviewContractStep({ data }: ReviewContractStepProps) {
  const [clientName, setClientName] = useState<string>('Not selected');

  useEffect(() => {
    loadClientName();
  }, [data.client_id, data.company_id]);

  const loadClientName = async () => {
    const clientId = data.client_id || data.company_id;
    if (!clientId) {
      setClientName('Not selected');
      return;
    }
    try {
      const clients = await getClients();
      const match = clients.find(client => client.id === clientId);
      setClientName(match?.name || clientId);
    } catch (error) {
      console.error('Error loading client name:', error);
      setClientName(clientId);
    }
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatBucketSummary = (
    overlay: BucketOverlayInput | null | undefined,
    mode: 'hours' | 'usage',
    unitLabel?: string
  ): string | null => {
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
        ? `${formatCurrency(overlay.overage_rate)}/${mode === 'hours' ? 'hour' : unitLabel || 'unit'}`
        : null;

    const rollover = overlay.allow_rollover ? 'rollover enabled' : 'no rollover';

    return `${formattedIncluded}${overage ? `, ${overage} overage` : ''}, ${rollover}`;
  };

  const parseLocalYMD = (ymd: string): Date | null => {
    // Parse a 'yyyy-MM-dd' string as a local date (no timezone shift)
    try {
      const d = parse(ymd, 'yyyy-MM-dd', new Date());
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    const local = parseLocalYMD(dateString) ?? new Date(dateString);
    return local.toLocaleDateString();
  };

  const calculateTotalMonthly = () => data.fixed_base_rate ?? 0;

  const hasFixedServices = data.fixed_services.length > 0;
  const hasHourlyServices = data.hourly_services.length > 0;
  const hasUsageServices = !!(data.usage_services && data.usage_services.length > 0);

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Review Contract</h3>
        <p className="text-sm text-gray-600">Review all contract details before creating.</p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-blue-600" />
          <h4 className="font-semibold">Contract Basics</h4>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Client</p>
              <p className="font-medium">{clientName || 'Not selected'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Contract Name</p>
              <p className="font-medium">{data.contract_name || 'Not specified'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Repeat className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Billing Frequency</p>
              <p className="font-medium">{BILLING_FREQUENCY_OPTIONS.find(opt => opt.value === data.billing_frequency)?.label || data.billing_frequency || 'Not specified'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-gray-400" />
            <div>
              <p className="text-gray-600">Contract Period</p>
              <p className="font-medium">{formatDate(data.start_date)} - {data.end_date ? formatDate(data.end_date) : 'Ongoing'}</p>
            </div>
          </div>
          {data.description && (
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 text-gray-400" />
              <div>
                <p className="text-gray-600">Description</p>
                <p className="font-medium">{data.description}</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {data.po_required && (
        <Card className="p-4 border-orange-200 bg-orange-50">
          <div className="flex items-center gap-2 mb-3">
            <FileCheck className="h-5 w-5 text-orange-600" />
            <h4 className="font-semibold">Purchase Order</h4>
            <Badge variant="primary" className="border-orange-300 text-orange-800">Required</Badge>
          </div>
          <div className="space-y-2 text-sm">
            {data.po_number && (
              <div className="flex items-start gap-2">
                <FileCheck className="h-4 w-4 mt-0.5 text-gray-400" />
                <div>
                  <p className="text-gray-600">PO Number</p>
                  <p className="font-medium">{data.po_number}</p>
                </div>
              </div>
            )}
            {data.po_amount && (
              <div className="flex items-start gap-2">
                <DollarSign className="h-4 w-4 mt-0.5 text-gray-400" />
                <div>
                  <p className="text-gray-600">PO Amount</p>
                  <p className="font-medium">{formatCurrency(data.po_amount)}</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {hasFixedServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-green-600" />
              <h4 className="font-semibold">Fixed Fee Services</h4>
            </div>
            <Badge variant="default" className="bg-green-100 text-green-800">{formatCurrency(data.fixed_base_rate)}/month</Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Services ({data.fixed_services.length})</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {data.fixed_services.map((service, idx) => (
                  <li key={idx} className="space-y-1">
                    <span className="font-medium">
                      {service.service_name || service.service_id} (Qty: {service.quantity})
                    </span>
                    {formatBucketSummary(service.bucket_overlay, 'hours') && (
                      <p className="text-xs text-blue-700 pl-4">
                        Bucket: {formatBucketSummary(service.bucket_overlay, 'hours')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <p className="text-gray-600">Proration: {data.enable_proration ? 'Enabled' : 'Disabled'}</p>
            </div>
          </div>
        </Card>
      )}

      {hasHourlyServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-purple-600" />
              <h4 className="font-semibold">Hourly Services</h4>
            </div>
            <Badge variant="default" className="bg-purple-100 text-purple-800">{data.hourly_services.length} services</Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Services & Rates</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {data.hourly_services.map((service, idx) => (
                  <li key={idx} className="space-y-1">
                    <span className="font-medium">
                      {service.service_name || service.service_id} - {formatCurrency(service.hourly_rate)}/hour
                    </span>
                    {formatBucketSummary(service.bucket_overlay, 'hours') && (
                      <p className="text-xs text-blue-700 pl-4">
                        Bucket: {formatBucketSummary(service.bucket_overlay, 'hours')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {(data.minimum_billable_time || data.round_up_to_nearest) && (
              <div className="pt-2 border-t space-y-1">
                {data.minimum_billable_time && (
                  <p className="text-gray-600"><strong>Minimum Time:</strong> {data.minimum_billable_time} minutes</p>
                )}
                {data.round_up_to_nearest && (
                  <p className="text-gray-600"><strong>Round Up:</strong> {data.round_up_to_nearest} minutes</p>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {hasUsageServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-600" />
              <h4 className="font-semibold">Usage-Based Services</h4>
            </div>
            <Badge variant="default" className="bg-indigo-100 text-indigo-800">
              {(data.usage_services?.length ?? 0)} services
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <ul className="list-disc list-inside space-y-1 ml-2">
              {(data.usage_services || []).map((service, idx) => (
                <li key={idx} className="space-y-1">
                  <span className="font-medium">
                    {service.service_name || service.service_id} - {formatCurrency(service.unit_rate)}/{service.unit_of_measure || 'unit'}
                  </span>
                  {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure) && (
                    <p className="text-xs text-blue-700 pl-4">
                      Bucket: {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-lg mb-1">Estimated Monthly Total</h4>
            <p className="text-sm text-gray-600">Fixed charges only (hourly & usage-based services billed as used)</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-blue-900">{formatCurrency(calculateTotalMonthly())}</p>
            <p className="text-xs text-gray-600">per month</p>
          </div>
        </div>
      </Card>

      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-sm text-amber-800"><strong>Before you finish:</strong></p>
        <ul className="text-sm text-amber-800 list-disc list-inside space-y-1 mt-2 ml-2">
          <li>Double-check all rates and service configurations</li>
          <li>Ensure the contract period is correct</li>
          <li>Review that all required services are included</li>
          <li>Note: You can edit the contract after creation</li>
        </ul>
      </div>
    </div>
  );
}
