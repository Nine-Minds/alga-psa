"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface Props {
  form: any; // react-hook-form UseFormReturn
  title: string;
  description: string;
}

export function ProcessingSettingsCard({ form, title, description }: Props) {
  const { t } = useTranslation('msp/email-providers');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="labelFilters">{t('forms.gmail.processing.labelFiltersLabel', {
              defaultValue: 'Gmail Labels to Monitor',
            })}</Label>
            <Input
              id="labelFilters"
              {...form.register('labelFilters')}
              placeholder={t('forms.gmail.processing.labelFiltersPlaceholder', {
                defaultValue: 'INBOX, Support, Custom Label',
              })}
            />
            <p className="text-xs text-muted-foreground">
              {t('forms.gmail.processing.labelFiltersHelp', {
                defaultValue: 'Comma-separated list of Gmail labels to monitor (default: INBOX)',
              })}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
