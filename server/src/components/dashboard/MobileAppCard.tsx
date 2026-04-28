'use client';

import React, { useEffect, useState } from 'react';
import qrcode from 'qrcode';
import { Smartphone, EyeOff } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const APP_STORE_URL = 'https://apps.apple.com/app/id6760326836';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.alga.psa.mobile';

interface StoreLinkProps {
  url: string;
  label: string;
  qrAlt: string;
  qrDataUrl: string | null;
}

function StoreLink({ url, label, qrAlt, qrDataUrl }: StoreLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center gap-2 rounded-md border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
    >
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt={qrAlt}
          width={160}
          height={160}
          className="h-40 w-40"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div className="h-40 w-40 animate-pulse rounded bg-slate-100" />
      )}
      <span className="text-sm font-medium text-slate-900">{label}</span>
    </a>
  );
}

interface MobileAppCardProps {
  onDismiss: () => void;
  isDismissing?: boolean;
}

export default function MobileAppCard({ onDismiss, isDismissing = false }: MobileAppCardProps) {
  const { t } = useTranslation('msp/dashboard');
  const [iosQr, setIosQr] = useState<string | null>(null);
  const [androidQr, setAndroidQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const options = { margin: 1, width: 640 };

    Promise.all([
      qrcode.toDataURL(APP_STORE_URL, options),
      qrcode.toDataURL(PLAY_STORE_URL, options),
    ])
      .then(([ios, android]) => {
        if (cancelled) return;
        setIosQr(ios);
        setAndroidQr(android);
      })
      .catch((err) => {
        console.error('Error generating mobile app QR codes:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const hideLabel = isDismissing
    ? t('mobileApp.hiding', { defaultValue: 'Hiding...' })
    : t('mobileApp.hide', { defaultValue: 'Hide' });

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-6 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
      <Button
        id="dismiss-dashboard-mobile-app-card"
        variant="outline"
        size="xs"
        onClick={onDismiss}
        disabled={isDismissing}
        className="absolute right-4 top-4 z-10 gap-1"
        aria-label={t('mobileApp.dismissAria', { defaultValue: 'Hide mobile app card' })}
      >
        <EyeOff className="h-3.5 w-3.5" />
        {hideLabel}
      </Button>

      <div className="mb-4 flex items-center gap-2">
        <Smartphone className="h-5 w-5 text-slate-700" />
        <h2 className="text-xl font-semibold" style={{ color: 'rgb(var(--color-text-900))' }}>
          {t('mobileApp.title', { defaultValue: 'Get the mobile app' })}
        </h2>
      </div>
      <p className="mb-6 text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
        {t('mobileApp.description', {
          defaultValue: 'Scan a QR code with your phone to download the Alga PSA mobile app.',
        })}
      </p>
      <div className="flex flex-wrap items-start justify-center gap-12 py-2">
        <StoreLink
          url={APP_STORE_URL}
          label={t('mobileApp.appStore', { defaultValue: 'App Store (iOS)' })}
          qrAlt={t('mobileApp.appStoreQrAlt', {
            defaultValue: 'QR code linking to the Alga PSA app on the Apple App Store',
          })}
          qrDataUrl={iosQr}
        />
        <StoreLink
          url={PLAY_STORE_URL}
          label={t('mobileApp.playStore', { defaultValue: 'Google Play (Android)' })}
          qrAlt={t('mobileApp.playStoreQrAlt', {
            defaultValue: 'QR code linking to the Alga PSA app on Google Play',
          })}
          qrDataUrl={androidQr}
        />
      </div>
    </div>
  );
}
