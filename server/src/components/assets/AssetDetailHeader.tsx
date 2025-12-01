import React from 'react';
import { Group, Text } from '@mantine/core';
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
import { Button } from '../../ui/Button';
import { StatusBadge } from './shared/StatusBadge';
import { Asset } from '../../interfaces/asset.interfaces';
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '../../ui/DropdownMenu';

interface AssetDetailHeaderProps {
  asset: Asset;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const getAssetIcon = (type: string) => {
  switch (type) {
    case 'workstation': return Monitor;
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
  const Icon = getAssetIcon(asset.asset_type);
  
  // Determine badge status
  const badgeStatus = asset.agent_status || 'unknown';

  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-4 border-b bg-white dark:bg-gray-800">
      <Group align="flex-start">
        <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <Icon size={32} className="text-gray-600 dark:text-gray-300" />
        </div>
        <div>
          <Group gap="xs" mb={4}>
            <Text size="xl" fw={700} className="leading-none">
              {asset.name}
            </Text>
            {asset.rmm_provider && (
              <StatusBadge 
                status={badgeStatus} 
                provider={asset.rmm_provider === 'ninjaone' ? 'NinjaOne' : asset.rmm_provider} 
                size="sm"
              />
            )}
          </Group>
          <Text size="sm" c="dimmed">
            Asset Tag: {asset.asset_tag}
          </Text>
        </div>
      </Group>

      <Group>
        {asset.rmm_provider && (
           <Button 
             variant="outline" 
             className="flex items-center gap-2"
             onClick={() => {
               // Initial implementation would log or show unimplemented
               console.log('Remote control clicked');
             }}
           >
             <MonitorPlay size={16} />
             Remote
           </Button>
        )}
        
        <Button 
          variant="outline"
          className="flex items-center gap-2"
        >
          <Ticket size={16} />
          Create Ticket
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
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
  );
};