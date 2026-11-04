'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslation } from '../../lib/i18n/client';

interface FeaturePlaceholderProps {
  featureName?: string;
  description?: string;
  estimatedDate?: string;
  className?: string;
}

export function FeaturePlaceholder({
  className = ''
}: FeaturePlaceholderProps) {
  const { t } = useTranslation('common');

  return (
    <div className={`flex items-center justify-center w-full h-full ${className}`} style={{ maxHeight: '90vh' }}>
      <Image
        src="/images/under-construction.png"
        alt={t('featurePlaceholder.description')}
        width={2100}
        height={1500}
        className="object-contain w-auto h-auto"
        style={{ 
          maxWidth: '90%',
          maxHeight: '90vh'
        }}
        priority
        quality={100}
      />
    </div>
  );
}
