'use client';

import { Flex, Text } from '@radix-ui/themes';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function PolicyManagement() {
  const { t } = useTranslation('msp/settings');

  return (
    <div>
      <Flex direction="column" gap="4">
        <Text size="5" weight="bold">
          {t('policyManagement.title')}
        </Text>
        <Text>
          {t('policyManagement.upgradeDescription')}
        </Text>
      </Flex>
    </div>
  );
}
