'use client';

import React from 'react';
import { ServiceCatalog } from '../../../../components/service-level-management/ServiceCatalog';

export default function ServiceCatalogPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ServiceCatalog />
    </div>
  );
}