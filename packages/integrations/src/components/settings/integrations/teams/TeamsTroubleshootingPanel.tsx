'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { TEAMS_DELIVERY_ERROR_CODES, TEAMS_DELIVERY_ERROR_REMEDIES } from './teamsTroubleshooting';

export function TeamsTroubleshootingPanel() {
  const { t } = useTranslation('msp/integrations');
  const [open, setOpen] = React.useState(false);

  return (
    <Card id="teams-troubleshooting-panel">
      <CardHeader>
        <CardTitle>{t('integrations.teams.settings.troubleshooting.title', { defaultValue: 'Delivery error reference' })}</CardTitle>
        <CardDescription>
          {t('integrations.teams.settings.troubleshooting.description', { defaultValue: 'What each Teams delivery error code means and how to resolve it.' })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <button
          id="teams-troubleshooting-toggle"
          type="button"
          className="mb-3 text-sm font-medium text-primary underline-offset-2 hover:underline"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open
            ? t('integrations.teams.settings.troubleshooting.hide', { defaultValue: 'Hide error reference' })
            : t('integrations.teams.settings.troubleshooting.show', { defaultValue: 'Show error reference' })}
        </button>

        {open ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('integrations.teams.settings.troubleshooting.columns.code', { defaultValue: 'Error code' })}</TableHead>
                  <TableHead>{t('integrations.teams.settings.troubleshooting.columns.cause', { defaultValue: 'Cause' })}</TableHead>
                  <TableHead>{t('integrations.teams.settings.troubleshooting.columns.remedy', { defaultValue: 'Remedy' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TEAMS_DELIVERY_ERROR_CODES.map((code) => {
                  const remedy = TEAMS_DELIVERY_ERROR_REMEDIES[code];
                  return (
                    <TableRow key={code} id={`teams-troubleshooting-row-${code.replace(/_/g, '-')}`}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{code}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t(remedy.causeKey, { defaultValue: remedy.causeDefault })}
                      </TableCell>
                      <TableCell className="text-xs">
                        {t(remedy.remedyKey, { defaultValue: remedy.remedyDefault })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
