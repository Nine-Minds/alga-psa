import React from 'react';
import { useRouter } from 'next/navigation';

// Dummy data directly in the page
const dummyAgreements = [
  {
    id: '1',
    name: 'Microsoft Enterprise Agreement - Acme Corp',
    product: 'Microsoft 365 E5',
    vendor: 'Microsoft',
    consumer: 'Acme Corporation',
    status: 'active' as const,
    marginRpxy: 15.5,
  },
  {
    id: '2',
    name: 'Adobe Creative Cloud - Design Team',
    product: 'Creative Cloud All Apps',
    vendor: 'Adobe',
    consumer: 'Design Studios Inc',
    status: 'active' as const,
    marginRpxy: 12.0,
  },
  {
    id: '3',
    name: 'Salesforce CRM - Global Sales',
    product: 'Sales Cloud Enterprise',
    vendor: 'Salesforce',
    consumer: 'Global Sales Corp',
    status: 'pending' as const,
    marginRpxy: 18.0,
  },
  {
    id: '4',
    name: 'AWS Cloud Services - Tech Startup',
    product: 'AWS Business Support',
    vendor: 'Amazon',
    consumer: 'Tech Innovations LLC',
    status: 'active' as const,
    marginRpxy: 20.0,
  },
  {
    id: '5',
    name: 'Google Workspace - Education',
    product: 'Google Workspace Enterprise',
    vendor: 'Google',
    consumer: 'City University',
    status: 'active' as const,
    marginRpxy: 10.5,
  },
];

export default function SoftwareOneAgreementsPage() {
  const router = useRouter();

  const handleRowClick = (agreementId: string) => {
    router.push(`/softwareone/agreement/${agreementId}`);
  };

  const getStatusBadge = (status: 'active' | 'inactive' | 'pending') => {
    const colors = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      pending: 'bg-yellow-100 text-yellow-800'
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Alga PSA - SoftwareOne Extension</h1>
        </div>
      </header>
      
      <main className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Agreements</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage your SoftwareOne agreements
          </p>
        </div>

        <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Agreement Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Vendor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Consumer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Margin %
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {dummyAgreements.map((agreement) => (
                <tr
                  key={agreement.id}
                  onClick={() => handleRowClick(agreement.id)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {agreement.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{agreement.product}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{agreement.vendor}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{agreement.consumer}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(agreement.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{agreement.marginRpxy}%</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}