'use client';

import React from 'react';
import { DataTable } from './DataTable';
import CustomSelect from './CustomSelect';
import type { ColumnDefinition } from '@alga-psa/types';

/**
 * The header-to-field mapping step of a spreadsheet import: one row per source
 * column showing a few sample values and a select for the field it maps to.
 * Extracted from the hand-rolled steps of the client, contact, ticket and task
 * import dialogs; the price book import is its first user.
 *
 * Copy is passed in by the caller (this package has no namespace of its own).
 */
export interface SpreadsheetColumnMappingTarget {
  value: string;
  label: string;
}

export interface SpreadsheetColumnMappingLabels {
  sourceColumn: string;
  sampleValues: string;
  mapsTo: string;
  ignoreColumn: string;
}

export interface SpreadsheetColumnMappingStepProps {
  /** Prefix for the element ids; row selects are `${id}-select-<index>`. */
  id: string;
  headers: readonly string[];
  /** A few parsed rows, keyed by source header. */
  sampleRows: ReadonlyArray<Record<string, string>>;
  targets: readonly SpreadsheetColumnMappingTarget[];
  /** Source header -> target value. A header that is absent is ignored. */
  mapping: Readonly<Record<string, string>>;
  onMappingChange: (mapping: Record<string, string>) => void;
  labels: SpreadsheetColumnMappingLabels;
}

interface MappingRow {
  header: string;
  index: number;
  samples: string;
}

const IGNORE = '__ignore__';

export function SpreadsheetColumnMappingStep({
  id,
  headers,
  sampleRows,
  targets,
  mapping,
  onMappingChange,
  labels,
}: SpreadsheetColumnMappingStepProps): React.JSX.Element {
  const rows: MappingRow[] = React.useMemo(
    () => headers.map((header, index) => ({
      header,
      index,
      samples: sampleRows.map((row) => row[header]).filter((value) => value).slice(0, 3).join(' · '),
    })),
    [headers, sampleRows],
  );

  const options = React.useMemo(
    () => [{ value: IGNORE, label: labels.ignoreColumn }, ...targets.map((target) => ({ value: target.value, label: target.label }))],
    [labels.ignoreColumn, targets],
  );

  const setTarget = (header: string, value: string) => {
    const next = { ...mapping };
    if (value === IGNORE) delete next[header];
    else next[header] = value;
    onMappingChange(next);
  };

  const columns: ColumnDefinition<MappingRow>[] = [
    { title: labels.sourceColumn, dataIndex: 'header', sortable: false },
    { title: labels.sampleValues, dataIndex: 'samples', sortable: false },
    {
      title: labels.mapsTo,
      dataIndex: 'header',
      id: 'maps-to',
      sortable: false,
      width: '16rem',
      render: (_value: string, record: MappingRow) => (
        <CustomSelect
          id={`${id}-select-${record.index}`}
          options={options}
          value={mapping[record.header] ?? IGNORE}
          onValueChange={(value) => setTarget(record.header, value)}
        />
      ),
    },
  ];

  return <DataTable id={`${id}-table`} data={rows} columns={columns} pagination={false} />;
}

export default SpreadsheetColumnMappingStep;
