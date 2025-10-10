import { getSession } from 'server/src/lib/auth/getSession';
import { redirect } from 'next/navigation';
import LicensePurchaseForm from 'server/src/components/licensing/LicensePurchaseForm';

export default async function LicensePurchasePage() {
  const session = await getSession();

  // Redirect to sign-in if not authenticated
  if (!session?.user) {
    redirect('/auth/msp/signin?callbackUrl=/msp/licenses/purchase');
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Purchase Additional Licenses
          </h1>
          <p className="text-gray-600">
            Add more user licenses to your AlgaPSA account
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 md:p-8">
          <LicensePurchaseForm userEmail={session.user.email} />
        </div>

        {/* Help Text */}
        <div className="mt-8 text-center text-sm text-gray-600">
          <p>
            Need help? Contact us at{' '}
            <a href="mailto:support@nineminds.com" className="text-purple-600 hover:text-purple-700 underline">
              support@nineminds.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
