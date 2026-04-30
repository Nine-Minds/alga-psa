'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { ColumnDefinition } from '@alga-psa/types';

export interface MyRequestsTableRow {
  submission_id: string;
  request_name: string;
  execution_status: 'pending' | 'succeeded' | 'failed';
  submitted_at: string;
  created_ticket_id?: string | null;
  ticket_number?: string | null;
}

interface MyRequestsTableLabels {
  request: string;
  submitted: string;
  status: string;
  ticket: string;
  noTicket: string;
  details: string;
  view: string;
  unknownDate: string;
  statuses: {
    pending: string;
    succeeded: string;
    failed: string;
  };
}

interface MyRequestsTableProps {
  rows: MyRequestsTableRow[];
  labels: MyRequestsTableLabels;
}

function formatDateTime(value: string, unknownLabel: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return unknownLabel;
  }
  return date.toLocaleString();
}

export function MyRequestsTable({ rows, labels }: MyRequestsTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const columns = useMemo<ColumnDefinition<MyRequestsTableRow>[]>(
    () => [
      {
        title: labels.request,
        dataIndex: 'request_name',
        render: (value) => (value as string) ?? '-',
      },
      {
        title: labels.submitted,
        dataIndex: 'submitted_at',
        render: (value) => formatDateTime(value as string, labels.unknownDate),
      },
      {
        title: labels.status,
        dataIndex: 'execution_status',
        render: (value) => {
          const status = value as MyRequestsTableRow['execution_status'];
          const tone =
            status === 'succeeded'
              ? 'success'
              : status === 'failed'
                ? 'error'
                : 'warning';
          const label =
            status === 'succeeded'
              ? labels.statuses.succeeded
              : status === 'failed'
                ? labels.statuses.failed
                : labels.statuses.pending;
          return <Badge variant={tone}>{label}</Badge>;
        },
      },
      {
        title: labels.ticket,
        dataIndex: 'created_ticket_id',
        sortable: false,
        render: (_value, row) => {
          if (!row.created_ticket_id) {
            return <span className="text-[rgb(var(--color-text-500))]">{labels.noTicket}</span>;
          }
          return (
            <Link
              href={`/client-portal/tickets/${row.created_ticket_id}`}
              className="text-[rgb(var(--color-primary-600))] hover:underline"
            >
              {row.ticket_number ? `#${row.ticket_number}` : labels.view}
            </Link>
          );
        },
      },
      {
        title: labels.details,
        dataIndex: 'submission_id',
        sortable: false,
        render: (_value, row) => (
          <Link
            href={`/client-portal/request-services/my-requests/${row.submission_id}`}
            className="text-[rgb(var(--color-primary-600))] hover:underline"
          >
            {labels.view}
          </Link>
        ),
      },
    ],
    [labels]
  );

  return (
    <DataTable
      id="client-portal-my-requests-table"
      data={rows}
      columns={columns}
      pagination
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      pageSize={pageSize}
      onItemsPerPageChange={(size) => {
        setPageSize(size);
        setCurrentPage(1);
      }}
    />
  );
}
