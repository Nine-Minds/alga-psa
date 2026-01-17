"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';

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
        </div>
      </CardContent>
    </Card>
  );
}
