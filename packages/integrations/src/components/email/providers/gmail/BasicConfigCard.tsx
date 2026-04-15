"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface Props {
  form: any; // react-hook-form UseFormReturn of either CE or EE types
  hasAttemptedSubmit: boolean;
  title: string;
  description: string;
}

export function BasicConfigCard({ form, hasAttemptedSubmit, title, description }: Props) {
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
            <Label htmlFor="providerName">{t('forms.gmail.basic.providerNameLabel', {
              defaultValue: 'Provider Name *',
            })}</Label>
            <Input
              id="providerName"
              {...form.register('providerName')}
              placeholder={t('forms.gmail.basic.providerNamePlaceholder', {
                defaultValue: 'e.g., Support Gmail',
              })}
              className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
            />
            {form.formState.errors.providerName && (
              <p className="text-sm text-red-500">{form.formState.errors.providerName.message as string}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mailbox">{t('forms.gmail.basic.mailboxLabel', {
              defaultValue: 'Gmail Address *',
            })}</Label>
            <Input
              id="mailbox"
              type="email"
              {...form.register('mailbox')}
              placeholder={t('forms.gmail.basic.mailboxPlaceholder', {
                defaultValue: 'support@client.com',
              })}
              className={hasAttemptedSubmit && form.formState.errors.mailbox ? 'border-red-500' : ''}
            />
            {form.formState.errors.mailbox && (
              <p className="text-sm text-red-500">{form.formState.errors.mailbox.message as string}</p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="isActive"
            checked={form.watch('isActive')}
            onCheckedChange={(checked: boolean) => form.setValue('isActive', checked)}
          />
          <Label htmlFor="isActive">{t('forms.gmail.basic.enableProvider', {
            defaultValue: 'Enable this provider',
          })}</Label>
        </div>
      </CardContent>
    </Card>
  );
}
