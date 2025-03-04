import React from 'react';
import TechnicianDispatchDashboard from 'server/src/components/technician-dispatch/TechnicianDispatchDashboard';

export default function TechnicianDispatchPage() {
  return (
    <div className="container mx-auto px-4">
      <h1 className="text-2xl font-bold my-4">Technician Dispatch Dashboard</h1>
      <TechnicianDispatchDashboard />
    </div>
  );
}
