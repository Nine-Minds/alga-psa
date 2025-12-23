import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Asset } from '../../../interfaces/asset.interfaces';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Network, Link as LinkIcon } from 'lucide-react';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';

interface RelatedAssetsTabProps {
  asset: Asset;
}

export const RelatedAssetsTab: React.FC<RelatedAssetsTabProps> = ({ asset }) => {
  const relationships = asset.relationships || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-semibold">Related Assets ({relationships.length})</CardTitle>
        <Button id="link-asset-btn" variant="outline" size="xs" className="flex items-center gap-2">
          <LinkIcon size={14} />
          Link Asset
        </Button>
      </CardHeader>
      <CardContent>
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
                      <div className="flex items-center gap-2">
                        <Network size={16} className="text-gray-400" />
                        <span className="text-gray-900">{rel.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-primary-50 text-primary-700 border-primary-100">
                        {rel.relationship_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {formatDateTime(new Date(rel.created_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                    </TableCell>
                    <TableCell>
                      <Button id={`unlink-asset-${rel.child_asset_id}-btn`} variant="ghost" size="xs" className="text-red-600 hover:text-red-700 hover:bg-red-50">Unlink</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-gray-500">
                    <div className="flex flex-col items-center gap-2">
                      <Network size={32} className="opacity-20" />
                      <p className="text-sm">No related assets linked.</p>
                      <Button id="link-asset-empty-state-btn" variant="ghost" size="xs">Link an asset</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
