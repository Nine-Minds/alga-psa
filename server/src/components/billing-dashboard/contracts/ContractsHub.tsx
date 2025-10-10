'use client';

import React, { useState } from 'react';
import Contracts from './Contracts';

const ContractsHub: React.FC = () => {
  // Trigger for refreshing data
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <Contracts
      onRefreshNeeded={handleRefreshData}
      refreshTrigger={refreshTrigger}
    />
  );
};

export default ContractsHub;
