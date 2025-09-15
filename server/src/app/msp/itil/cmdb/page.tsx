'use client';

import React from 'react';
import { CMDBDashboard } from '../../../../components/cmdb/CMDBDashboard';

export default function CMDBPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CMDBDashboard />
    </div>
  );
}