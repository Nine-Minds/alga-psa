"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';

interface Props {
  form: any; // react-hook-form UseFormReturn of either CE or EE types
  hasAttemptedSubmit: boolean;
  title: string;
  description: string;
}

export function BasicConfigCard({ form, hasAttemptedSubmit, title, description }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="providerName">Provider Name *</Label>
            <Input
              id="providerName"
              {...form.register('providerName')}
              placeholder="e.g., Support Gmail"
              className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
            />
            {form.formState.errors.providerName && (
              <p className="text-sm text-red-500">{form.formState.errors.providerName.message as string}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mailbox">Gmail Address *</Label>
            <Input
              id="mailbox"
              type="email"
              {...form.register('mailbox')}
              placeholder="support@client.com"
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
          <Label htmlFor="isActive">Enable this provider</Label>
        </div>
      </CardContent>
    </Card>
  );
}

