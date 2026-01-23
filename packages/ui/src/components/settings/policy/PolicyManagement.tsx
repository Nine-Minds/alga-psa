'use client';

import { Flex, Text } from '@radix-ui/themes';

export default function PolicyManagement() {
  return (
    <div>
      <Flex direction="column" gap="4">
        <Text size="5" weight="bold">Policy Management</Text>
        <Text>Policy management is an Enterprise Edition feature. Please upgrade to access advanced policy controls.</Text>
      </Flex>
    </div>
  );
}
