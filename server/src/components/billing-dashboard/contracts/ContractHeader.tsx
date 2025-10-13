'use client';

import React from 'react';
import { Badge } from 'server/src/components/ui/Badge';
import { IContract } from 'server/src/interfaces/contract.interfaces';

interface ContractHeaderProps {
  contract: IContract;
}

const ContractHeader: React.FC<ContractHeaderProps> = ({ contract }) => {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{contract.contract_name}</h1>
        <Badge className={contract.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
          {contract.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>
      <div className="text-sm text-gray-500 mt-1">
        Billing Frequency: {contract.billing_frequency ? contract.billing_frequency.replace('-', ' ') : 'N/A'}
      </div>
      {contract.contract_description && (
        <p className="text-gray-600 mt-1">{contract.contract_description}</p>
      )}
    </div>
  );
};

export default ContractHeader;
