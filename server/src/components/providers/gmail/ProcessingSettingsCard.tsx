"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Switch } from 'server/src/components/ui/Switch';

interface Props {
  form: any; // react-hook-form UseFormReturn
  title: string;
  description: string;
}

export function ProcessingSettingsCard({ form, title, description }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <Switch
            id="autoProcessEmails"
            checked={form.watch('autoProcessEmails')}
            onCheckedChange={(checked: boolean) => form.setValue('autoProcessEmails', checked)}
          />
          <Label htmlFor="autoProcessEmails">Automatically process new emails</Label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="labelFilters">Gmail Labels to Monitor</Label>
            <Input
              id="labelFilters"
              {...form.register('labelFilters')}
              placeholder="INBOX, Support, Custom Label"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of Gmail labels to monitor (default: INBOX)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxEmailsPerSync">Max Emails Per Sync</Label>
            <Input
              id="maxEmailsPerSync"
              type="number"
              {...form.register('maxEmailsPerSync', { valueAsNumber: true })}
              min="1"
              max="1000"
            />
            <p className="text-xs text-muted-foreground">
              Maximum number of emails to process in each sync (1-1000)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

