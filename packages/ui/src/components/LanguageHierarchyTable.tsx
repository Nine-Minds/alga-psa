'use client';

import React from 'react';
import { useTranslation } from '../lib/i18n/client';
import { Alert, AlertDescription } from './Alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';

type HierarchyRowKey =
  | 'userPreference'
  | 'clientUserLanguage'
  | 'clientPortalDefault'
  | 'organizationDefault'
  | 'systemDefault';

const ROWS: Array<{ key: HierarchyRowKey; href?: string }> = [
  { key: 'userPreference', href: '/msp/profile' },
  { key: 'clientUserLanguage', href: '/msp/clients' },
  { key: 'clientPortalDefault' },
  { key: 'organizationDefault' },
  { key: 'systemDefault' },
];

interface LanguageHierarchyTableProps {
  hideHeader?: boolean;
  className?: string;
}

export function LanguageHierarchyTable({
  hideHeader = false,
  className = '',
}: LanguageHierarchyTableProps) {
  const { t } = useTranslation('common');
  const base = 'language.hierarchyTable';

  return (
    <Alert variant="info" className={className}>
      <AlertDescription>
        {!hideHeader && (
          <>
            <h4 className="font-medium mb-1">{t(`${base}.title`)}</h4>
            <p className="mb-3">{t(`${base}.description`)}</p>
          </>
        )}
        <div className="overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-[rgb(var(--color-border-300))]">
                <TableHead className="h-9 px-3 text-xs font-semibold uppercase tracking-wide w-16">
                  {t(`${base}.columns.priority`)}
                </TableHead>
                <TableHead className="h-9 px-3 text-xs font-semibold uppercase tracking-wide">
                  {t(`${base}.columns.source`)}
                </TableHead>
                <TableHead className="h-9 px-3 text-xs font-semibold uppercase tracking-wide">
                  {t(`${base}.columns.appliesTo`)}
                </TableHead>
                <TableHead className="h-9 px-3 text-xs font-semibold uppercase tracking-wide">
                  {t(`${base}.columns.whereSet`)}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((row, index) => {
                const whereSetLabel = t(`${base}.rows.${row.key}.whereSet`);
                return (
                  <TableRow
                    key={row.key}
                    className="hover:bg-transparent border-b border-[rgb(var(--color-border-200))] last:border-b-0"
                  >
                    <TableCell className="px-3 py-2 align-top text-sm">{index + 1}</TableCell>
                    <TableCell className="px-3 py-2 align-top text-sm font-medium">
                      {t(`${base}.rows.${row.key}.source`)}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-sm">
                      {t(`${base}.rows.${row.key}.appliesTo`)}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-sm">
                      {row.href ? (
                        <a
                          href={row.href}
                          className="underline text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-700))]"
                        >
                          {whereSetLabel}
                        </a>
                      ) : (
                        <span>{whereSetLabel}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </AlertDescription>
    </Alert>
  );
}
