import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { TextInput, Select, Badge, Group } from '@mantine/core';
import { Search } from 'lucide-react';
import { Asset } from '../../../interfaces/asset.interfaces';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';

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
    <Card title="Software Inventory">
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
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Publisher</th>
              <th className="px-4 py-3">Install Date</th>
            </tr>
          </thead>
          <tbody>
            {filteredSoftware.length > 0 ? (
              filteredSoftware.map((sw) => (
                <tr key={sw.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium">{sw.name}</td>
                  <td className="px-4 py-3 text-gray-500">{sw.version}</td>
                  <td className="px-4 py-3 text-gray-500">{sw.publisher}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {sw.installDate ? new Date(sw.installDate).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No software found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="mt-4 text-xs text-gray-400 text-right">
        Total Items: {filteredSoftware.length}
      </div>
    </Card>
  );
};