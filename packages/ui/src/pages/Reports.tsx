import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function Reports() {
  const { t } = useTranslation('msp/reports');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">
        {t('page.title', { defaultValue: 'Reports' })}
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-2">
            {t('reportsPage.cards.timeUtilization.title', { defaultValue: 'Time Utilization' })}
          </h2>
          <div className="h-64 bg-gray-200 flex items-center justify-center">
            {t('reportsPage.cards.timeUtilization.placeholder', {
              defaultValue: '[Time Utilization Chart Placeholder]',
            })}
          </div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-2">
            {t('reportsPage.cards.projectProgress.title', { defaultValue: 'Project Progress' })}
          </h2>
          <div className="h-64 bg-gray-200 flex items-center justify-center">
            {t('reportsPage.cards.projectProgress.placeholder', {
              defaultValue: '[Project Progress Chart Placeholder]',
            })}
          </div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-2">
            {t('reportsPage.cards.revenueByClient.title', { defaultValue: 'Revenue by Client' })}
          </h2>
          <div className="h-64 bg-gray-200 flex items-center justify-center">
            {t('reportsPage.cards.revenueByClient.placeholder', {
              defaultValue: '[Revenue by Client Chart Placeholder]',
            })}
          </div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-2">
            {t('reportsPage.cards.teamPerformance.title', { defaultValue: 'Team Performance' })}
          </h2>
          <div className="h-64 bg-gray-200 flex items-center justify-center">
            {t('reportsPage.cards.teamPerformance.placeholder', {
              defaultValue: '[Team Performance Chart Placeholder]',
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
