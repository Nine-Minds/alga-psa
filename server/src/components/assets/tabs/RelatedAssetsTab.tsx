import React from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Asset } from '../../../interfaces/asset.interfaces';
import { Text, Badge, Group, Button } from '@mantine/core';
import { Network, Link as LinkIcon } from 'lucide-react';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';

interface RelatedAssetsTabProps {
  asset: Asset;
}

export const RelatedAssetsTab: React.FC<RelatedAssetsTabProps> = ({ asset }) => {
  const relationships = asset.relationships || [];

  return (
    <Card 
      title={`Related Assets (${relationships.length})`}
      action={
        <Button variant="outline" size="xs" leftSection={<LinkIcon size={14} />}>
          Link Asset
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Asset Name</th>
              <th className="px-4 py-3">Relationship</th>
              <th className="px-4 py-3">Linked Date</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {relationships.length > 0 ? (
              relationships.map((rel, index) => (
                <tr key={`${rel.child_asset_id}-${index}`} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium">
                    <Group gap="xs">
                      <Network size={16} className="text-gray-400" />
                      {rel.name}
                    </Group>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="light" color="blue">{rel.relationship_type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDateTime(new Date(rel.created_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="subtle" size="xs" color="red">Unlink</Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-500 flex flex-col items-center gap-2">
                  <Network size={32} className="opacity-20" />
                  <Text>No related assets linked.</Text>
                  <Button variant="subtle" size="xs">Link an asset</Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
