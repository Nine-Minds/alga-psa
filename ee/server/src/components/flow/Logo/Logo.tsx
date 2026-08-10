// /src/components/Logo/Logo.tsx
import React from 'react';
import Image from 'next/image';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface LogoProps {
  width?: number;
  height?: number;
}

const Logo: React.FC<LogoProps> = ({ width = 50, height = 50 }) => {
  const { t } = useTranslation('msp/workflows');

  return (
    <Image
      src="/logo.svg"
      alt={t('designer.logoAlt', { defaultValue: 'Workflow Editor Logo' })}
      width={width}
      height={height}
    />
  );
};

export default Logo;