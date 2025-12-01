import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { TextInput, Select, Group } from '@mantine/core';
import { Search } from 'lucide-react';
import { Asset } from '../../../interfaces/asset.interfaces';

interface SoftwareInventoryTabProps {
  asset: Asset;
}

export const SoftwareInventoryTab: React.FC<SoftwareInventoryTabProps> = ({ asset }) => {
  const [search, setSearch] = useState('');
  
  // Fallback to getting software from asset extension data
  // In a real implementation, this would query the normalized asset_software table
  const softwareList = React.useMemo(() => {
    const rawList = asset.workstation?.installed_software || asset.server?.installed_software || [];
    // NinjaOne typically returns array of objects with name, version, installDate, etc.
    // or just strings depending on mapping. Assuming objects based on plan.
    return rawList.map((item: any, index) => ({
      id: index,
      name: item.name || item.softwareName || 'Unknown',
      version: item.version || 'Unknown',
      publisher: item.publisher || 'Unknown',
      installDate: item.installDate || null,
    }));
  }, [asset]);

  const filteredSoftware = softwareList.filter(sw => 
    sw.name.toLowerCase().includes(search.toLowerCase()) || 
    sw.publisher.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Software Inventory</CardTitle>
      </CardHeader>
      <CardContent>
        <Group mb="md">
          <TextInput 
            placeholder="Search software..." 
            leftSection={<Search size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            className="flex-1"
          />
          <Select 
            placeholder="Category" 
            data={['All', 'Browser', 'Security', 'Productivity', 'Development']}
            defaultValue="All"
            className="w-48"
          />
        </Group>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Publisher</TableHead>
                <TableHead>Install Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSoftware.length > 0 ? (
                filteredSoftware.map((sw) => (
                  <TableRow key={sw.id}>
                    <TableCell className="font-medium">{sw.name}</TableCell>
                    <TableCell className="text-muted-foreground">{sw.version}</TableCell>
                    <TableCell className="text-muted-foreground">{sw.publisher}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {sw.installDate ? new Date(sw.installDate).toLocaleDateString() : '-'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No software found matching your search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        
        <div className="mt-4 text-xs text-gray-400 text-right">
          Total Items: {filteredSoftware.length}
        </div>
      </CardContent>
    </Card>
  );
};