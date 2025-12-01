import React from 'react';
import { Text, Group, ActionIcon, CopyButton, Tooltip } from '@mantine/core';
import { Copy, Check } from 'lucide-react';

interface CopyableFieldProps {
  label: string;
  value: string | null | undefined;
  showCopyButton?: boolean;
  truncate?: boolean;
}

export const CopyableField: React.FC<CopyableFieldProps> = ({
  label,
  value,
  showCopyButton = true,
  truncate = false,
}) => {
  if (!value) {
    return (
      <div>
        <Text size="xs" c="dimmed">{label}</Text>
        <Text size="sm" c="dimmed">N/A</Text>
      </div>
    );
  }

  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Group gap="xs">
        <Text size="sm" truncate={truncate ? 'end' : undefined} style={{ maxWidth: truncate ? '150px' : undefined }}>
          {value}
        </Text>
        {showCopyButton && (
          <CopyButton value={value} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy} size="xs">
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        )}
      </Group>
    </div>
  );
};
