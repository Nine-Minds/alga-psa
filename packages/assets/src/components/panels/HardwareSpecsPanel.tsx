import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import type { RmmCachedData, Asset } from '@alga-psa/types';
import { UtilizationBar } from '../shared/UtilizationBar';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/assets');
  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  if (!data) {
    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{t('hardwareSpecsPanel.title', { defaultValue: 'Hardware Specifications' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 text-center py-8">
            {t('hardwareSpecsPanel.empty', { defaultValue: 'No hardware data available' })}
          </p>
        </CardContent>
      </Card>
    );
  }

  const cpuModel = asset?.workstation?.cpu_model || asset?.server?.cpu_model || t('hardwareSpecsPanel.values.unknownCpu', {
    defaultValue: 'Unknown CPU'
  });

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>{t('hardwareSpecsPanel.title', { defaultValue: 'Hardware Specifications' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* CPU */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm font-bold text-gray-700 w-12 shrink-0">
              {t('hardwareSpecsPanel.fields.cpu', { defaultValue: 'CPU' })}:
            </span>
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
               <span className="text-sm text-gray-900 min-w-[120px]">{cpuModel}</span>
               <div className="flex items-center gap-2 flex-1">
                 <span className="text-sm text-gray-500">
                   {t('hardwareSpecsPanel.fields.utilization', { defaultValue: 'Utilization' })}:
                 </span>
                 <div className="w-32">
                   <UtilizationBar 
                     value={data.cpu_utilization_percent} 
                     showLabel={false}
                     size="sm"
                   />
                 </div>
                 <span className="text-sm text-gray-900">{data.cpu_utilization_percent}%</span>
               </div>
            </div>
          </div>

          {/* Memory */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm font-bold text-gray-700 w-12 shrink-0">
              {t('hardwareSpecsPanel.fields.ram', { defaultValue: 'RAM' })}:
            </span>
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
               <span className="text-sm text-gray-900 min-w-[120px]">
                 {data.memory_total_gb
                   ? t('hardwareSpecsPanel.values.unifiedMemory', {
                     defaultValue: '{{size}}GB Unified Memory',
                     size: data.memory_total_gb
                   })
                   : t('hardwareSpecsPanel.values.unknown', { defaultValue: 'Unknown' })}
               </span>
               <div className="flex items-center gap-2 flex-1">
                 <span className="text-sm text-gray-500">
                   {t('hardwareSpecsPanel.fields.utilization', { defaultValue: 'Utilization' })}:
                 </span>
                 <div className="w-32">
                   <UtilizationBar 
                     value={data.memory_utilization_percent} 
                     showLabel={false}
                     size="sm"
                   />
                 </div>
                 <span className="text-sm text-gray-900">
                   {data.memory_utilization_percent}% 
                   {data.memory_used_gb
                     ? t('hardwareSpecsPanel.values.memoryUsed', {
                       defaultValue: ' ({{size}}GB Used)',
                       size: data.memory_used_gb.toFixed(1)
                     })
                     : ''}
                 </span>
               </div>
            </div>
          </div>

          {/* Storage */}
          <div>
             {data.storage.map((drive, index) => (
              <div key={index} className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2 last:mb-0">
                 <span className="text-sm font-bold text-gray-700 w-16 shrink-0">
                   {t('hardwareSpecsPanel.fields.storage', { defaultValue: 'Storage' })}:
                 </span>
                 <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                   <span className="text-sm text-gray-900 min-w-[120px]">{drive.name}</span>
                   <div className="flex items-center gap-2 flex-1">
                     <div className="w-32">
                       <UtilizationBar 
                         value={drive.utilization_percent} 
                         showLabel={false}
                         size="sm"
                       />
                     </div>
                     <span className="text-sm text-gray-900">
                       {t('hardwareSpecsPanel.values.freeStorage', {
                         defaultValue: '{{size}} GB Free',
                         size: drive.free_gb.toFixed(1)
                       })}
                     </span>
                   </div>
                 </div>
              </div>
             ))}
             {data.storage.length === 0 && (
               <p className="text-sm text-gray-500">
                 {t('hardwareSpecsPanel.emptyStorage', { defaultValue: 'No storage drives detected' })}
               </p>
             )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
