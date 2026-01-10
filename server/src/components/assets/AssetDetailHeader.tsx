import React, { useState } from 'react';
import { useSWRConfig } from 'swr';
import { 
  Laptop, 
  Server, 
  Smartphone, 
  Printer, 
  Network, 
  HelpCircle,
  MoreVertical,
  Edit,
  Trash2,
  RefreshCw,
  Power,
  ArrowLeft
} from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import BackNav from 'server/src/components/ui/BackNav';
import { StatusBadge } from './shared/StatusBadge';
import { Asset } from '../../interfaces/asset.interfaces';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { RemoteAccessButton } from './RemoteAccessButton';
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
        <div className="flex items-center gap-4">
          <BackNav href="/msp/assets">
            <div className="flex items-center gap-2">
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Back to Assets</span>
            </div>
          </BackNav>
          <div className="h-10 w-px bg-gray-200 mx-2 hidden md:block" />
          <Icon size={40} className="text-gray-700" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold leading-none text-gray-900">
                {asset.name}
              </h1>
              {asset.rmm_provider && (
                <StatusBadge 
                  status={badgeStatus} 
                  provider={asset.rmm_provider === 'ninjaone' ? 'NinjaOne' : asset.rmm_provider} 
                  size="md"
                />
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Asset Tag: {asset.asset_tag}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {asset.rmm_provider && (
            <RemoteAccessButton
              asset={asset}
              variant="default"
            />
          )}
          
          <Button 
            id="create-ticket-header-btn"
            variant="outline"
            className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 flex items-center gap-2"
            onClick={() => setIsTicketDialogOpen(true)}
          >
            Create Ticket
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                id="asset-actions-btn"
                variant="outline" 
                className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 flex items-center gap-2 px-3"
              >
                Actions
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5 text-sm font-semibold text-gray-900">Actions</div>
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
        </div>
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