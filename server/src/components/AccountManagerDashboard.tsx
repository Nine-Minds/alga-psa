// server/src/components/AccountManagerDashboard.tsx

'use client'

import React from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'server/src/components/ui/Table';
import { Users, ArrowUp, AlertCircle } from 'lucide-react';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const revenueData = [
  { name: 'Jan', value: 4000 },
  { name: 'Feb', value: 3000 },
  { name: 'Mar', value: 5000 },
  { name: 'Apr', value: 4500 },
  { name: 'May', value: 6000 },
  { name: 'Jun', value: 5500 },
];

interface AccountManagerDashboardProps {
  clients: IClient[];
}

const AccountManagerDashboard: React.FC<AccountManagerDashboardProps> = ({ clients }) => {
  const totalClients = clients.length;
  const atRiskClients = clients.filter(client => client.properties?.status === 'At Risk').length;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Account Manager Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>Total Clients</CardHeader>
          <CardContent className="text-3xl font-bold flex items-center">
            <Users className="mr-2" /> {totalClients}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>Revenue This Month</CardHeader>
          <CardContent className="text-3xl font-bold flex items-center text-green-600">
            <ArrowUp className="mr-2" /> $125,000
          </CardContent>
        </Card>
        <Card>
          <CardHeader>At-Risk Clients</CardHeader>
          <CardContent className="text-3xl font-bold flex items-center text-red-600">
            <AlertCircle className="mr-2" /> {atRiskClients}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>Revenue Trend</CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#8884d8" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>Recent Client Activity</CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Last Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action Needed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.slice(0, 5).map((client): React.JSX.Element => (
                <TableRow key={client.client_id}>
                  <TableCell>{client.client_name}</TableCell>
                  <TableCell>{new Date(client.properties?.last_contact_date || '').toLocaleDateString()}</TableCell>
                  <TableCell>{client.properties?.status}</TableCell>
                  <TableCell>Follow-up needed</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AccountManagerDashboard;
