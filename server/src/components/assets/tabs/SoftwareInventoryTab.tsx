import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
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
        <div className="flex items-center gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input 
              placeholder="Search software..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <CustomSelect 
            placeholder="Category" 
            options={[
              { value: 'All', label: 'All' },
              { value: 'Browser', label: 'Browser' },
              { value: 'Security', label: 'Security' },
              { value: 'Productivity', label: 'Productivity' },
              { value: 'Development', label: 'Development' }
            ]}
            value="All"
            onValueChange={() => {}}
            className="w-48"
          />
        </div>

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
                    <TableCell className="font-medium text-gray-900">{sw.name}</TableCell>
                    <TableCell className="text-gray-500">{sw.version}</TableCell>
                    <TableCell className="text-gray-500">{sw.publisher}</TableCell>
                    <TableCell className="text-gray-500">
                      {sw.installDate ? new Date(sw.installDate).toLocaleDateString() : '-'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-gray-400">
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