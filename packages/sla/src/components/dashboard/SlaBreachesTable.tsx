'use client';

/**
 * SLA Breaches Table Component
 *
 * Table showing recent SLA breaches.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ISlaRecentBreach } from '../../types';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface SlaBreachesTableProps {
  data: ISlaRecentBreach[];
  loading?: boolean;
}

export const SlaBreachesTable: React.FC<SlaBreachesTableProps> = ({ data, loading }) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Breaches</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Breaches</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No SLA breaches in the selected period
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Breaches</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Ticket</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Client</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Priority</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Assignee</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Breach Type</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">When</th>
              </tr>
            </thead>
            <tbody>
              {data.map((breach) => (
                <tr key={breach.ticketId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3">
                    <Link
                      href={`/msp/tickets/${breach.ticketId}`}
                      className="text-primary-600 hover:underline font-medium"
                    >
                      #{breach.ticketNumber}
                    </Link>
                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{breach.ticketTitle}</p>
                  </td>
                  <td className="py-2 px-3 text-sm text-gray-700">{breach.companyName}</td>
                  <td className="py-2 px-3">
                    <Badge variant="outline" className="text-xs">
                      {breach.priorityName}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-sm text-gray-700">
                    {breach.assigneeName || <span className="text-gray-400">Unassigned</span>}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex gap-1">
                      {breach.responseBreached && (
                        <Badge variant="destructive" className="text-xs">Response</Badge>
                      )}
                      {breach.resolutionBreached && (
                        <Badge variant="destructive" className="text-xs">Resolution</Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-sm text-gray-500">
                    {formatDistanceToNow(new Date(breach.breachedAt), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
