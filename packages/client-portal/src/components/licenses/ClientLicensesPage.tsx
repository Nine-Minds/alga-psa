'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getClientLicenses } from '../../actions/client-portal-actions/client-licenses';
import type { ClientLicenseContractSummary } from '../../actions/client-portal-actions/client-licenses';

function statusBadge(status: string, label: string) {
  const colors: Record<string, { bg: string; text: string }> = {
    active:      { bg: '#dcfce7', text: '#15803d' },
    inactive:    { bg: '#f3f4f6', text: '#6b7280' },
    expired:     { bg: '#fef3c7', text: '#92400e' },
    terminated:  { bg: '#fef2f2', text: '#b91c1c' },
  };
  const c = colors[status] ?? colors.inactive;
  return (
    <span style={{
      display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '9999px',
      background: c.bg, color: c.text, fontSize: '0.78rem', fontWeight: 600,
      textTransform: 'capitalize',
    }}>
      {label}
    </span>
  );
}

/**
 * Portal Licenses view (C6).
 *
 * Lists the customer's appliance license contracts with tier / term / expiry /
 * renewal status, and offers a "Download key" action per contract.
 *
 * Route: /client-portal/licenses
 */
export default function ClientLicensesPage() {
  const { t } = useTranslation('client-portal');
  const { formatDate: formatLocalizedDate } = useFormatters();
  const [licenses, setLicenses] = useState<ClientLicenseContractSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Lives in the component so it can use the app's resolved locale; a
  // module-level toLocaleDateString() would follow the browser instead.
  const formatDate = useCallback((iso: string | null): string => {
    if (!iso) return '—';
    return formatLocalizedDate(new Date(iso), { year: 'numeric', month: 'short', day: 'numeric' });
  }, [formatLocalizedDate]);

  const transportLabels: Record<string, string> = {
    'connected-monthly': t('licenses.transports.connectedMonthly', 'Connected (monthly)'),
    'connected-annual':  t('licenses.transports.connectedAnnual', 'Connected (annual)'),
    'airgap-annual':     t('licenses.transports.airgapAnnual', 'Air-gapped (annual)'),
  };

  const tierLabels: Record<string, string> = {
    pro:     t('licenses.tiers.pro', 'Pro'),
    premium: t('licenses.tiers.premium', 'Pro'),
  };

  const statusLabels: Record<string, string> = {
    active:     t('licenses.statuses.active', 'Active'),
    inactive:   t('licenses.statuses.inactive', 'Inactive'),
    expired:    t('licenses.statuses.expired', 'Expired'),
    terminated: t('licenses.statuses.terminated', 'Terminated'),
  };

  useEffect(() => {
    getClientLicenses().then((data) => {
      setLicenses(data);
      setLoading(false);
    }).catch(() => {
      setLicenses([]);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div style={{ padding: '2rem' }}>{t('licenses.loading', 'Loading licenses…')}</div>;
  }

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('licenses.pageTitle', 'Appliance Licenses')}</h1>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        {t('licenses.pageDescription', 'Your Alga appliance Pro license entitlements. Key documents are also available in the Documents section.')}
      </p>

      {licenses && licenses.length === 0 ? (
        <div style={{
          padding: '2rem', border: '1px dashed #e5e7eb', borderRadius: '0.5rem',
          textAlign: 'center', color: '#9ca3af',
        }}>
          {t('licenses.empty.message', 'No appliance licenses found.')}{' '}
          <a href="/client-portal/request-services" style={{ color: '#2563eb', textDecoration: 'underline' }}>
            {t('licenses.empty.purchaseLink', 'Purchase a license')}
          </a>{' '}
          {t('licenses.empty.suffix', 'to get started.')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {(licenses ?? []).map((lic) => {
            const expiringSoon = lic.endDate
              ? (new Date(lic.endDate).getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000
              : false;

            return (
              <div
                key={lic.clientContractId}
                style={{
                  border: `1px solid ${expiringSoon && lic.status === 'active' ? '#fde68a' : '#e5e7eb'}`,
                  borderRadius: '0.5rem',
                  padding: '1.25rem',
                  background: expiringSoon && lic.status === 'active' ? '#fffbeb' : '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>
                      {tierLabels[lic.tier] ?? lic.tier} — {transportLabels[lic.transport] ?? lic.transport}
                    </span>
                    <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '0.15rem' }}>
                      {lic.contractName}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {statusBadge(lic.status, statusLabels[lic.status] ?? lic.status)}
                    {lic.licenseDocumentId && (
                      <a
                        href={`/client-portal/documents?highlight=${lic.licenseDocumentId}`}
                        style={{
                          padding: '0.3rem 0.75rem', background: '#2563eb', color: '#fff',
                          borderRadius: '0.375rem', fontSize: '0.8rem', textDecoration: 'none',
                        }}
                      >
                        {t('licenses.downloadKey', 'Download key')}
                      </a>
                    )}
                  </div>
                </div>

                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.25rem 1rem', marginTop: '0.75rem', fontSize: '0.875rem' }}>
                  <dt style={{ color: '#6b7280' }}>{t('licenses.validFrom', 'Valid from')}</dt>
                  <dd>{formatDate(lic.startDate)}</dd>
                  <dt style={{ color: '#6b7280' }}>{t('licenses.expires', 'Expires')}</dt>
                  <dd>
                    {formatDate(lic.endDate)}
                    {expiringSoon && lic.status === 'active' && (
                      <span style={{ marginLeft: '0.5rem', color: '#92400e', fontWeight: 600, fontSize: '0.8rem' }}>
                        ⚠ {t('licenses.expiringSoon', 'Expiring soon')}
                      </span>
                    )}
                  </dd>
                  <dt style={{ color: '#6b7280' }}>{t('licenses.renewal', 'Renewal')}</dt>
                  <dd style={{ textTransform: 'capitalize' }}>{lic.renewalMode === 'auto' ? t('licenses.renewalModes.auto', 'Auto-renews') : lic.renewalMode === 'manual' ? t('licenses.renewalModes.manual', 'Manual renewal') : '—'}</dd>
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
