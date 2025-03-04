// ServiceCatalog.tsx
import React from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import ServiceCatalogManager from './ServiceCatalogManager';

const ServiceCatalog: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Service Catalog</h3>
      </CardHeader>
      <CardContent>
        <ServiceCatalogManager />
      </CardContent>
    </Card>
  );
};

export default ServiceCatalog;
