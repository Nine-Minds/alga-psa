'use client';

import React from 'react';
import { IInvoiceCharge } from 'server/src/interfaces/invoice.interfaces';
import { Badge } from '@alga-psa/ui/components/Badge';

interface ContractInvoiceItemsProps {
  items: IInvoiceCharge[];
}

interface GroupedItems {
  [key: string]: {
    contractName: string;
    items: IInvoiceCharge[];
    subtotal: number;
  };
}

const ContractInvoiceItems: React.FC<ContractInvoiceItemsProps> = ({ items }) => {
  // Group items by contract
  const groupedItems: GroupedItems = {};
  const nonContractItems: IInvoiceCharge[] = [];

  // First pass: group items by contract
  items.forEach(item => {
    if (item.client_contract_id && item.contract_name) {
      if (!groupedItems[item.client_contract_id]) {
        groupedItems[item.client_contract_id] = {
          contractName: item.contract_name,
          items: [],
          subtotal: 0
        };
      }
      groupedItems[item.client_contract_id].items.push(item);
      groupedItems[item.client_contract_id].subtotal += item.total_price;
    } else {
      nonContractItems.push(item);
    }
  });

  return (
    <div className="space-y-6">
      {/* Render contract groups */}
      {Object.keys(groupedItems).map(contractId => {
        const contract = groupedItems[contractId];
        return (
          <div key={contractId} className="border rounded-md p-4">
            <h3 className="text-lg font-medium mb-2">{contract.contractName}</h3>
            <table className="w-full">
              <thead className="text-sm text-gray-500">
                <tr>
                  <th className="text-left py-2">Description</th>
                  <th className="text-right py-2">Quantity</th>
                  <th className="text-right py-2">Rate</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {contract.items.map((item, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span>{item.description}</span>
                        {item.service_item_kind === 'product' ? (
                          <Badge variant="secondary">Product</Badge>
                        ) : null}
                        {item.service_item_kind === 'product' && item.service_sku ? (
                          <span className="text-xs text-muted-foreground">{item.service_sku}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-right">{item.quantity}</td>
                    <td className="text-right">${(item.unit_price / 100).toFixed(2)}</td>
                    <td className="text-right">${(item.total_price / 100).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td colSpan={3} className="py-2 text-right">Contract Subtotal:</td>
                  <td className="text-right">${(contract.subtotal / 100).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Render non-contract items */}
      {nonContractItems.length > 0 && (
        <div className="border rounded-md p-4">
          <h3 className="text-lg font-medium mb-2">Other Items</h3>
          <table className="w-full">
            <thead className="text-sm text-gray-500">
              <tr>
                <th className="text-left py-2">Description</th>
                <th className="text-right py-2">Quantity</th>
                <th className="text-right py-2">Rate</th>
                <th className="text-right py-2">Amount</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {nonContractItems.map((item, i) => (
                <tr key={i} className="border-t">
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <span>{item.description}</span>
                      {item.service_item_kind === 'product' ? (
                        <Badge variant="secondary">Product</Badge>
                      ) : null}
                      {item.service_item_kind === 'product' && item.service_sku ? (
                        <span className="text-xs text-muted-foreground">{item.service_sku}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="text-right">{item.quantity}</td>
                  <td className="text-right">${(item.unit_price / 100).toFixed(2)}</td>
                  <td className="text-right">${(item.total_price / 100).toFixed(2)}</td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td colSpan={3} className="py-2 text-right">Other Items Subtotal:</td>
                <td className="text-right">
                  ${(nonContractItems.reduce((sum, item) => sum + item.total_price, 0) / 100).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ContractInvoiceItems;
