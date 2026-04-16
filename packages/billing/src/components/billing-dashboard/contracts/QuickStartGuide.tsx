'use client';

import React, { useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Coins,
  FileText,
  Clock,
  Droplet,
  Activity,
  CheckCircle,
  PlayCircle,
  X,
  ChevronRight
} from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface QuickStartGuideProps {
  onDismiss?: () => void;
  onCreateContract?: () => void;
}

export const QuickStartGuide: React.FC<QuickStartGuideProps> = ({
  onDismiss,
  onCreateContract
}) => {
  const { t } = useTranslation('msp/contracts');
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isExpanded) {
    return (
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PlayCircle className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-[rgb(var(--color-text-900))]">
              {t('quickStart.title', { defaultValue: 'Quick Start Guide' })}
            </span>
            <Badge variant="info">
              {t('quickStart.badge.new', { defaultValue: 'New' })}
            </Badge>
          </div>
          <Button
            id="quickstart-show-guide"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(true)}
            className="text-blue-600 hover:text-blue-700"
          >
            {t('quickStart.actions.showGuide', { defaultValue: 'Show Guide' })}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <PlayCircle className="h-6 w-6 text-blue-600" />
          <div>
            <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
              {t('quickStart.title', { defaultValue: 'Quick Start Guide' })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('quickStart.subtitle', { defaultValue: 'Learn how to create and manage contracts' })}
            </p>
          </div>
          <Badge variant="info">
            {t('quickStart.badge.new', { defaultValue: 'New' })}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
            <Button
              id="quickstart-minimize"
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(false)}
              className="text-muted-foreground"
            >
              {t('quickStart.actions.minimize', { defaultValue: 'Minimize' })}
            </Button>
          {onDismiss && (
            <Button
              id="quickstart-dismiss"
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="text-muted-foreground"
              aria-label={t('quickStart.actions.dismiss', { defaultValue: 'Dismiss' })}
              title={t('quickStart.actions.dismiss', { defaultValue: 'Dismiss' })}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Step 1 */}
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-blue-700 font-semibold">1</span>
            </div>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-[rgb(var(--color-text-900))] mb-1">
              {t('quickStart.steps.createContract.title', { defaultValue: 'Create a Contract' })}
            </h4>
            <p className="text-sm text-muted-foreground mb-2">
              {t('quickStart.steps.createContract.description', {
                defaultValue: 'Click "New Contract" to start the wizard. Choose a client and name your contract.',
              })}
            </p>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t('quickStart.steps.createContract.requiredFields', {
                  defaultValue: 'Required: Client, Contract Name, Start Date',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <span className="text-green-700 font-semibold">2</span>
            </div>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-[rgb(var(--color-text-900))] mb-1">
              {t('quickStart.steps.configureBilling.title', { defaultValue: 'Configure Billing' })}
            </h4>
            <p className="text-sm text-muted-foreground mb-2">
              {t('quickStart.steps.configureBilling.description', {
                defaultValue: 'Choose your billing model(s). You can combine multiple types:',
              })}
            </p>
            <div className="space-y-2 ml-2">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-green-600" />
                <span className="text-sm text-[rgb(var(--color-text-700))]">
                  <strong>{t('quickStart.billingModels.fixedFee.label', { defaultValue: 'Fixed Fee:' })}</strong>{' '}
                  {t('quickStart.billingModels.fixedFee.description', { defaultValue: 'Same price every month' })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-600" />
                <span className="text-sm text-[rgb(var(--color-text-700))]">
                  <strong>{t('quickStart.billingModels.hourly.label', { defaultValue: 'Hourly:' })}</strong>{' '}
                  {t('quickStart.billingModels.hourly.description', { defaultValue: 'Bill by time tracked' })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Droplet className="h-4 w-4 text-blue-600" />
                <span className="text-sm text-[rgb(var(--color-text-700))]">
                  <strong>{t('quickStart.billingModels.bucketHours.label', { defaultValue: 'Bucket Hours:' })}</strong>{' '}
                  {t('quickStart.billingModels.bucketHours.description', { defaultValue: 'Prepaid hours + overage' })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-orange-600" />
                <span className="text-sm text-[rgb(var(--color-text-700))]">
                  <strong>{t('quickStart.billingModels.usageBased.label', { defaultValue: 'Usage-Based:' })}</strong>{' '}
                  {t('quickStart.billingModels.usageBased.description', { defaultValue: 'Bill by consumption/usage' })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <span className="text-purple-700 font-semibold">3</span>
            </div>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-[rgb(var(--color-text-900))] mb-1">
              {t('quickStart.steps.reviewCreate.title', { defaultValue: 'Review & Create' })}
            </h4>
            <p className="text-sm text-muted-foreground mb-2">
              {t('quickStart.steps.reviewCreate.description', {
                defaultValue: 'Double-check everything before creating. You can always edit later.',
              })}
            </p>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t('quickStart.steps.reviewCreate.tip', {
                  defaultValue: 'Tip: At least one service line is required',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Best Practices */}
        <div className="mt-6 pt-4 border-t border-blue-200">
          <h4 className="font-semibold text-[rgb(var(--color-text-900))] mb-2 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-blue-600" />
            {t('quickStart.bestPractices.title', { defaultValue: 'Best Practices' })}
          </h4>
          <ul className="space-y-1 ml-6 text-sm text-muted-foreground">
            <li className="list-disc">
              {t('quickStart.bestPractices.items.clearNames', {
                defaultValue: 'Use clear, descriptive contract names (e.g., "Acme Corp - MSP Services Q4 2024")',
              })}
            </li>
            <li className="list-disc">
              {t('quickStart.bestPractices.items.partialPeriodAdjustment', {
                defaultValue: 'Use partial-period adjustment when contract dates cover only part of a service period',
              })}
            </li>
            <li className="list-disc">
              {t('quickStart.bestPractices.items.endDates', {
                defaultValue: 'Set end dates for fixed-term contracts to track renewal dates',
              })}
            </li>
            <li className="list-disc">
              {t('quickStart.bestPractices.items.poNumbers', {
                defaultValue: 'Add PO numbers when required by client procurement policies',
              })}
            </li>
          </ul>
        </div>

        {/* Action Button */}
        {onCreateContract && (
          <div className="mt-6 pt-4 border-t border-blue-200">
            <Button
              id="quickstart-create-contract"
              onClick={onCreateContract}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <FileText className="h-4 w-4 mr-2" />
              {t('quickStart.actions.createFirstContract', { defaultValue: 'Create Your First Contract' })}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};
