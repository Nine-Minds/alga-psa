'use client';

import React from 'react';
import Image from 'next/image';

interface FeaturePlaceholderProps {
  featureName?: string;
  description?: string;
  estimatedDate?: string;
  className?: string;
}

export function FeaturePlaceholder({
  className = ''
}: FeaturePlaceholderProps) {
  return (
    <div className={`flex items-center justify-center w-full h-full ${className}`} style={{ maxHeight: '90vh' }}>
      <Image
        src="/images/under-construction.png"
        alt="404 - This Page is Under Construction. You've reached a part of the site that isn't quite ready yet. Alga is laying the groundwork behind the scenes. Come back soon!"
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