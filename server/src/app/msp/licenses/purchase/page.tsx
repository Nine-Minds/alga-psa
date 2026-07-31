import { ArrowLeft } from 'lucide-react';
import LicensePurchaseForm from '@enterprise/components/licensing/LicensePurchaseForm';
import BackButton from '@/components/common/BackButton';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export const dynamic = 'force-dynamic';

export default async function LicensePurchasePage() {
  const [{ t }, { t: tCommon }] = await Promise.all([
    getServerTranslation(undefined, 'msp/licensing'),
    getServerTranslation(undefined, 'common'),
  ]);

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      {/* Back Button */}
      <div className="mb-6">
        <BackButton id="back-button" variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {tCommon('actions.back', { defaultValue: 'Back' })}
        </BackButton>
      </div>

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
          {t('purchasePage.title', { defaultValue: 'Purchase Licenses' })}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t('purchasePage.description', {
            defaultValue: 'Add more user licenses to your AlgaPSA account',
          })}
        </p>
      </div>

      {/* Purchase Form */}
      <LicensePurchaseForm />
    </div>
  );
}
