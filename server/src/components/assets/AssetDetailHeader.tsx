import React, { useState } from 'react';
import { Group, Text } from '@mantine/core';
import { useSWRConfig } from 'swr';
import { 
  Monitor, 
  Laptop, 
  Server, 
  Smartphone, 
  Printer, 
  Network, 
  HelpCircle,
  MonitorPlay,
  Ticket,
  MoreVertical,
  Edit,
  Trash2,
  RefreshCw,
  Power
} from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { StatusBadge } from './shared/StatusBadge';
import { Asset } from '../../interfaces/asset.interfaces';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from 'server/src/components/ui/DropdownMenu';

interface AssetDetailHeaderProps {
  asset: Asset;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const getAssetIcon = (type: string) => {
  switch (type) {
    case 'workstation': return Laptop; // Changed to Laptop as primary for workstation per mockup
    case 'server': return Server;
    case 'mobile_device': return Smartphone;
    case 'printer': return Printer;
    case 'network_device': return Network;
    default: return HelpCircle;
  }
};

export const AssetDetailHeader: React.FC<AssetDetailHeaderProps> = ({ 
  asset,
  onRefresh,
  isRefreshing 
}) => {
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const { mutate } = useSWRConfig();
  const Icon = getAssetIcon(asset.asset_type);
  
  // Determine badge status
  const badgeStatus = asset.agent_status || 'unknown';

  const handleTicketAdded = () => {
    mutate(['asset', asset.asset_id, 'tickets']);
  };

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-4 bg-white border-b border-gray-200">
        <Group align="center">
          <Icon size={40} className="text-gray-700" />
          <div>
            <Group gap="xs" align="center">
              <Text size="xl" fw={700} className="leading-none text-gray-900">
                {asset.name}
              </Text>
              {asset.rmm_provider && (
                <StatusBadge 
                  status={badgeStatus} 
                  provider={asset.rmm_provider === 'ninjaone' ? 'NinjaOne' : asset.rmm_provider} 
                  size="md"
                />
              )}
            </Group>
            <Text size="sm" c="dimmed" mt={2}>
              Asset Tag: {asset.asset_tag}
            </Text>
          </div>
        </Group>

        <Group>
          {asset.rmm_provider && (
             <Button 
               variant="filled" 
               className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
               onClick={() => {
                 console.log('Remote control clicked');
               }}
             >
               <MonitorPlay size={16} />
               Remote Control
             </Button>
          )}
          
          <Button 
            variant="outline"
            className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 flex items-center gap-2"
            onClick={() => setIsTicketDialogOpen(true)}
          >
            Create Ticket
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 flex items-center gap-2 px-3">
                Actions
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {asset.rmm_provider && (
                <>
                  <DropdownMenuItem onClick={onRefresh} disabled={isRefreshing}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Power className="mr-2 h-4 w-4" />
                    Reboot Device
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem>
                <Edit className="mr-2 h-4 w-4" />
                Edit Asset
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Asset
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Group>
      </div>

      <QuickAddTicket
        open={isTicketDialogOpen}
        onOpenChange={setIsTicketDialogOpen}
        onTicketAdded={handleTicketAdded}
        prefilledClient={asset.client_id ? {
          id: asset.client_id,
          name: asset.client?.client_name || 'Unknown Client'
        } : undefined}
        assetId={asset.asset_id}
      />
    </>
  );
};