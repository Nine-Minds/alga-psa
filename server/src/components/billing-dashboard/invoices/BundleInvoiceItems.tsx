'use client';

import React from 'react';
import { IInvoiceItem } from 'server/src/interfaces/invoice.interfaces';

interface BundleInvoiceItemsProps {
  items: IInvoiceItem[];
}

interface GroupedItems {
  [key: string]: {
    bundleName: string;
    items: IInvoiceItem[];
    subtotal: number;
  };
}

const BundleInvoiceItems: React.FC<BundleInvoiceItemsProps> = ({ items }) => {
  // Group items by bundle
  const groupedItems: GroupedItems = {};
  const nonBundleItems: IInvoiceItem[] = [];

  // First pass: group items by bundle
  items.forEach(item => {
    if (item.company_bundle_id && item.bundle_name) {
      if (!groupedItems[item.company_bundle_id]) {
        groupedItems[item.company_bundle_id] = {
          bundleName: item.bundle_name,
          items: [],
          subtotal: 0
        };
      }
      groupedItems[item.company_bundle_id].items.push(item);
      groupedItems[item.company_bundle_id].subtotal += item.total_price;
    } else {
      nonBundleItems.push(item);
    }
  });

  return (
    <div className="space-y-6">
      {/* Render bundle groups */}
      {Object.keys(groupedItems).map(bundleId => {
        const bundle = groupedItems[bundleId];
        return (
          <div key={bundleId} className="border rounded-md p-4">
            <h3 className="text-lg font-medium mb-2">{bundle.bundleName}</h3>
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
                {bundle.items.map((item, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2">{item.description}</td>
                    <td className="text-right">{item.quantity}</td>
                    <td className="text-right">${(item.unit_price / 100).toFixed(2)}</td>
                    <td className="text-right">${(item.total_price / 100).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td colSpan={3} className="py-2 text-right">Bundle Subtotal:</td>
                  <td className="text-right">${(bundle.subtotal / 100).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Render non-bundle items */}
      {nonBundleItems.length > 0 && (
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
              {nonBundleItems.map((item, i) => (
                <tr key={i} className="border-t">
                  <td className="py-2">{item.description}</td>
                  <td className="text-right">{item.quantity}</td>
                  <td className="text-right">${(item.unit_price / 100).toFixed(2)}</td>
                  <td className="text-right">${(item.total_price / 100).toFixed(2)}</td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td colSpan={3} className="py-2 text-right">Other Items Subtotal:</td>
                <td className="text-right">
                  ${(nonBundleItems.reduce((sum, item) => sum + item.total_price, 0) / 100).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default BundleInvoiceItems;