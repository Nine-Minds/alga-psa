import React from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset Name</TableHead>
              <TableHead>Relationship</TableHead>
              <TableHead>Linked Date</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {relationships.length > 0 ? (
              relationships.map((rel, index) => (
                <TableRow key={`${rel.child_asset_id}-${index}`}>
                  <TableCell className="font-medium">
                    <Group gap="xs">
                      <Network size={16} className="text-muted-foreground" />
                      {rel.name}
                    </Group>
                  </TableCell>
                  <TableCell>
                    <Badge variant="light" color="blue">{rel.relationship_type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(new Date(rel.created_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                  </TableCell>
                  <TableCell>
                    <Button variant="subtle" size="xs" color="red">Unlink</Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Network size={32} className="opacity-20" />
                    <Text>No related assets linked.</Text>
                    <Button variant="subtle" size="xs">Link an asset</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};
