import React from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Stack, Text, Group } from '@mantine/core';
import { RmmCachedData } from '../../../interfaces/asset.interfaces';
import { UtilizationBar } from '../shared/UtilizationBar';

interface HardwareSpecsPanelProps {
  data: RmmCachedData | null | undefined;
  isLoading: boolean;
}

export const HardwareSpecsPanel: React.FC<HardwareSpecsPanelProps> = ({
  data,
  isLoading
}) => {
  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  if (!data) {
    return (
      <Card title="Hardware Specifications">
        <Text c="dimmed" ta="center" py="xl">No hardware data available</Text>
      </Card>
    );
  }

  return (
    <Card title="Hardware Specifications">
      <Stack gap="lg">
        {/* CPU */}
        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>CPU</Text>
            <Text size="xs" c="dimmed">Utilization</Text>
          </Group>
          <UtilizationBar 
            value={data.cpu_utilization_percent} 
            label="CPU Load"
            showLabel={true}
          />
        </div>

        {/* Memory */}
        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>Memory</Text>
            <Text size="xs" c="dimmed">
              {data.memory_used_gb !== null && data.memory_total_gb !== null 
                ? `${data.memory_used_gb.toFixed(1)}GB / ${data.memory_total_gb}GB` 
                : 'Utilization'}
            </Text>
          </Group>
          <UtilizationBar 
            value={data.memory_utilization_percent} 
            label="RAM Usage"
            showLabel={true}
          />
        </div>

        {/* Storage */}
        <div>
          <Text size="sm" fw={500} mb="xs">Storage</Text>
          <Stack gap="md">
            {data.storage.map((drive, index) => (
              <div key={index}>
                <Group justify="space-between" mb={2}>
                  <Text size="xs" fw={500}>{drive.name}</Text>
                  <Text size="xs" c="dimmed">
                    {drive.free_gb.toFixed(1)}GB Free / {drive.total_gb.toFixed(1)}GB Total
                  </Text>
                </Group>
                <UtilizationBar 
                  value={drive.utilization_percent} 
                  showLabel={false}
                  tooltip={`${drive.utilization_percent.toFixed(1)}% Used`}
                  size="sm"
                />
              </div>
            ))}
            {data.storage.length === 0 && (
              <Text size="xs" c="dimmed">No storage drives detected</Text>
            )}
          </Stack>
        </div>
      </Stack>
    </Card>
  );
};
