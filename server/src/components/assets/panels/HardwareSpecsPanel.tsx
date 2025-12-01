import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Stack, Text, Group } from '@mantine/core';
import { RmmCachedData, Asset } from '../../../interfaces/asset.interfaces';
import { UtilizationBar } from '../shared/UtilizationBar';

interface HardwareSpecsPanelProps {
  data: RmmCachedData | null | undefined;
  asset?: Asset;
  isLoading: boolean;
}

export const HardwareSpecsPanel: React.FC<HardwareSpecsPanelProps> = ({
  data,
  asset,
  isLoading
}) => {
  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  if (!data) {
    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Hardware Specifications</CardTitle>
        </CardHeader>
        <CardContent>
          <Text c="dimmed" ta="center" py="xl">No hardware data available</Text>
        </CardContent>
      </Card>
    );
  }

  const cpuModel = asset?.workstation?.cpu_model || asset?.server?.cpu_model || 'Unknown CPU';

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>Hardware Specifications</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack gap="sm">
          {/* CPU */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Text size="sm" fw={700} className="w-12 shrink-0">CPU:</Text>
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
               <Text size="sm" className="min-w-[120px]">{cpuModel}</Text>
               <div className="flex items-center gap-2 flex-1">
                 <Text size="sm" c="dimmed">Utilization:</Text>
                 <div className="w-32">
                   <UtilizationBar 
                     value={data.cpu_utilization_percent} 
                     showLabel={false}
                     size="sm"
                   />
                 </div>
                 <Text size="sm">{data.cpu_utilization_percent}%</Text>
               </div>
            </div>
          </div>

          {/* Memory */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Text size="sm" fw={700} className="w-12 shrink-0">RAM:</Text>
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
               <Text size="sm" className="min-w-[120px]">
                 {data.memory_total_gb ? `${data.memory_total_gb}GB Unified Memory` : 'Unknown'}
               </Text>
               <div className="flex items-center gap-2 flex-1">
                 <Text size="sm" c="dimmed">Utilization:</Text>
                 <div className="w-32">
                   <UtilizationBar 
                     value={data.memory_utilization_percent} 
                     showLabel={false}
                     size="sm"
                   />
                 </div>
                 <Text size="sm">
                   {data.memory_utilization_percent}% 
                   {data.memory_used_gb ? ` (${data.memory_used_gb.toFixed(1)}GB Used)` : ''}
                 </Text>
               </div>
            </div>
          </div>

          {/* Storage */}
          <div>
             {data.storage.map((drive, index) => (
              <div key={index} className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2 last:mb-0">
                 <Text size="sm" fw={700} className="w-16 shrink-0">Storage:</Text>
                 <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                   <Text size="sm" className="min-w-[120px]">{drive.name}</Text>
                   <div className="flex items-center gap-2 flex-1">
                     <div className="w-32">
                       <UtilizationBar 
                         value={drive.utilization_percent} 
                         showLabel={false}
                         size="sm"
                       />
                     </div>
                     <Text size="sm">
                       {drive.free_gb.toFixed(1)} GB Free
                     </Text>
                   </div>
                 </div>
              </div>
             ))}
             {data.storage.length === 0 && (
               <Text size="sm" c="dimmed">No storage drives detected</Text>
             )}
          </div>
        </Stack>
      </CardContent>
    </Card>
  );
};
