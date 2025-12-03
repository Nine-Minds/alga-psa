import React from 'react';
import { Progress, Text, Group, Tooltip } from '@mantine/core';

interface UtilizationBarProps {
  value: number | null; // 0-100
  label?: string; // e.g., "45%"
  showLabel?: boolean;
  colorThresholds?: { warning: number; critical: number };
  tooltip?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const UtilizationBar: React.FC<UtilizationBarProps> = ({
  value,
  label,
  showLabel = true,
  colorThresholds = { warning: 70, critical: 90 },
  tooltip,
  size = 'md',
}) => {
  if (value === null || value === undefined) {
    return <Text size="sm" c="dimmed">N/A</Text>;
  }

  let color = 'green';
  if (value >= colorThresholds.critical) {
    color = 'red';
  } else if (value >= colorThresholds.warning) {
    color = 'yellow';
  }

  const content = (
    <div style={{ width: '100%' }}>
      {showLabel && (
        <Group justify="space-between" mb={4}>
          <Text size="xs" c="dimmed">{label}</Text>
          <Text size="xs" fw={500}>{Math.round(value)}%</Text>
        </Group>
      )}
      <Progress 
        value={value} 
        color={color} 
        size={size} 
        radius="xl" 
        striped={value > 90}
        animated={value > 90}
      />
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip label={tooltip}>
        {content}
      </Tooltip>
    );
  }

  return content;
};
