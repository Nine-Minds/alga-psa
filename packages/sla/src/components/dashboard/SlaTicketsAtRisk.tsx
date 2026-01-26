'use client';

/**
 * SLA Tickets At Risk Component
 *
 * Table showing tickets that are at risk of breaching SLA.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ISlaTicketAtRisk } from '../../types';
import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';

interface SlaTicketsAtRiskProps {
  data: ISlaTicketAtRisk[];
  loading?: boolean;
}

export const SlaTicketsAtRisk: React.FC<SlaTicketsAtRiskProps> = ({ data, loading }) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Tickets At Risk
          </CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Tickets At Risk
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No tickets currently at risk of SLA breach
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatTimeRemaining = (minutes: number): string => {
    if (minutes < 0) {
      const absMinutes = Math.abs(minutes);
      if (absMinutes < 60) return `${absMinutes}m overdue`;
      const hours = Math.floor(absMinutes / 60);
      const mins = absMinutes % 60;
      return `${hours}h ${mins}m overdue`;
    }
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const getUrgencyColor = (percent: number, minutesRemaining: number): string => {
    if (minutesRemaining < 0) return 'bg-red-100 text-red-800';
    if (percent >= 90) return 'bg-red-100 text-red-800';
    if (percent >= 75) return 'bg-amber-100 text-amber-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Tickets At Risk
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Ticket</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Client</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Priority</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">SLA Type</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Time Remaining</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-gray-600">Progress</th>
              </tr>
            </thead>
            <tbody>
              {data.map((ticket) => (
                <tr key={`${ticket.ticketId}-${ticket.slaType}`} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3">
                    <Link
                      href={`/msp/tickets/${ticket.ticketId}`}
                      className="text-primary-600 hover:underline font-medium"
                    >
                      #{ticket.ticketNumber}
                    </Link>
                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{ticket.ticketTitle}</p>
                  </td>
                  <td className="py-2 px-3 text-sm text-gray-700">{ticket.companyName}</td>
                  <td className="py-2 px-3">
                    <Badge variant="outline" className="text-xs">
                      {ticket.priorityName}
                    </Badge>
                  </td>
                  <td className="py-2 px-3">
                    <Badge
                      variant="outline"
                      className={`text-xs ${ticket.slaType === 'response' ? 'border-blue-300 text-blue-700' : 'border-purple-300 text-purple-700'}`}
                    >
                      {ticket.slaType === 'response' ? 'Response' : 'Resolution'}
                    </Badge>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      <Clock className={`h-4 w-4 ${ticket.minutesRemaining < 0 ? 'text-red-500' : 'text-amber-500'}`} />
                      <span className={`text-sm font-medium ${ticket.minutesRemaining < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                        {formatTimeRemaining(ticket.minutesRemaining)}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden max-w-[100px]">
                        <div
                          className={`h-full ${ticket.percentElapsed >= 100 ? 'bg-red-500' : ticket.percentElapsed >= 75 ? 'bg-amber-500' : 'bg-yellow-500'}`}
                          style={{ width: `${Math.min(ticket.percentElapsed, 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium ${getUrgencyColor(ticket.percentElapsed, ticket.minutesRemaining).replace('bg-', 'text-').replace('-100', '-700')}`}>
                        {ticket.percentElapsed}%
                      </span>
                    </div>
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
