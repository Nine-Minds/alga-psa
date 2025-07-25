import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dummyAgreements } from '../data/dummyAgreements';
import { Agreement } from '../types/agreement';

interface AgreementDetailProps {
  agreementId: string;
}

export function AgreementDetail({ agreementId }: AgreementDetailProps) {
  const router = useRouter();
  const [showSuccess, setShowSuccess] = useState(false);
  
  // Find the agreement from dummy data
  const agreement = dummyAgreements.find(a => a.id === agreementId);
  
  if (!agreement) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Agreement not found</p>
        </div>
        <button
          onClick={() => router.push('/softwareone/agreements')}
          className="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Back to Agreements
        </button>
      </div>
    );
  }

  const handleActivate = () => {
    // Show success message
    setShowSuccess(true);
    // Hide after 3 seconds
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const getStatusBadge = (status: Agreement['status']) => {
    const colors = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      pending: 'bg-yellow-100 text-yellow-800'
    };

    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status]}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/softwareone/agreements')}
          className="text-blue-600 hover:text-blue-800 text-sm mb-4 flex items-center"
        >
          ← Back to Agreements
        </button>
        
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{agreement.name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              Agreement ID: {agreement.id}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            {getStatusBadge(agreement.status)}
            {agreement.status !== 'active' && (
              <button
                onClick={handleActivate}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Activate
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Success Message */}
      {showSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800">Agreement activated successfully!</p>
        </div>
      )}

      {/* Agreement Details */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Agreement Details</h2>
        </div>
        
        <div className="px-6 py-4">
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-500">Product</dt>
              <dd className="mt-1 text-sm text-gray-900">{agreement.product}</dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Vendor</dt>
              <dd className="mt-1 text-sm text-gray-900">{agreement.vendor}</dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Consumer</dt>
              <dd className="mt-1 text-sm text-gray-900">{agreement.consumer}</dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Currency</dt>
              <dd className="mt-1 text-sm text-gray-900">{agreement.currency}</dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">SPx Year</dt>
              <dd className="mt-1 text-sm text-gray-900">{agreement.spxy}</dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Margin %</dt>
              <dd className="mt-1 text-sm text-gray-900">{agreement.marginRpxy}%</dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Created</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(agreement.createdAt).toLocaleDateString()}
              </dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Last Updated</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(agreement.updatedAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Additional Sections (placeholder for tabs in future) */}
      <div className="mt-6 bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Additional Information</h2>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-gray-600">
            Additional tabs for Subscriptions, Orders, Consumer details, and Billing configuration will be added in future phases.
          </p>
        </div>
      </div>
    </div>
  );
}