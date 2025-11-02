'use client';

import React from 'react';

interface SystemMonitoringWrapperProps {
  children: React.ReactNode;
}

export default function SystemMonitoringWrapper({ children }: SystemMonitoringWrapperProps) {
  return <>{children}</>;
}
