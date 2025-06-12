'use client';

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/Tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '../../ui/Alert';
import ImportTab from './ImportTab';

export default function ImportExportHome() {
  const [activeTab, setActiveTab] = useState('import');

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="export" disabled>Export</TabsTrigger>
        </TabsList>
        
        <TabsContent value="import" className="space-y-4">
          <ImportTab />
        </TabsContent>
        
        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle>Export Data</CardTitle>
              <CardDescription>
                Export your data from Alga PSA to external systems
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Export functionality coming soon. This feature will allow you to export your
                  companies, contacts, and other data to various formats and external systems.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}