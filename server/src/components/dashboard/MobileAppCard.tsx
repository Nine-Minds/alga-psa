'use client';

import React, { useEffect, useState } from 'react';
import qrcode from 'qrcode';
import { Smartphone, EyeOff, ZoomIn } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const APP_STORE_URL = 'https://apps.apple.com/app/id6760326836';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.alga.psa.mobile';

interface ZoomedQr {
  src: string;
  label: string;
  alt: string;
}

interface ZoomQrButtonProps {
  id: string;
  ariaLabel: string;
  onZoom: () => void;
}

function ZoomQrButton({ id, ariaLabel, onZoom }: ZoomQrButtonProps) {
  return (
    <Button
      id={id}
      variant="ghost"
      size="xs"
      onClick={onZoom}
      className="absolute right-1.5 top-1.5 w-7 px-0"
      aria-label={ariaLabel}
    >
      <ZoomIn className="h-4 w-4" />
    </Button>
  );
}

interface StoreLinkProps {
  url: string;
  label: string;
  qrAlt: string;
  qrDataUrl: string | null;
  zoomId: string;
  zoomAriaLabel: string;
  onZoom: () => void;
}

function StoreLink({ url, label, qrAlt, qrDataUrl, zoomId, zoomAriaLabel, onZoom }: StoreLinkProps) {
  return (
    <div className="relative">
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
      {qrDataUrl ? <ZoomQrButton id={zoomId} ariaLabel={zoomAriaLabel} onZoom={onZoom} /> : null}
    </div>
  );
}

interface MobileAppCardProps {
  onDismiss: () => void;
  isDismissing?: boolean;
  selfHost?: boolean;
}

export default function MobileAppCard({ onDismiss, isDismissing = false, selfHost = false }: MobileAppCardProps) {
  const { t } = useTranslation('msp/dashboard');
  const [iosQr, setIosQr] = useState<string | null>(null);
  const [androidQr, setAndroidQr] = useState<string | null>(null);
  const [connectQr, setConnectQr] = useState<string | null>(null);
  const [zoomedQr, setZoomedQr] = useState<ZoomedQr | null>(null);

  useEffect(() => {
    let cancelled = false;
    const options = { margin: 1, width: 640 };

    Promise.all([
      qrcode.toDataURL(APP_STORE_URL, options),
      qrcode.toDataURL(PLAY_STORE_URL, options),
      selfHost
        ? qrcode.toDataURL(`alga://server?url=${encodeURIComponent(window.location.origin)}`, options)
        : Promise.resolve(null),
    ])
      .then(([ios, android, connect]) => {
        if (cancelled) return;
        setIosQr(ios);
        setAndroidQr(android);
        setConnectQr(connect);
      })
      .catch((err) => {
        console.error('Error generating mobile app QR codes:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [selfHost]);

  const hideLabel = isDismissing
    ? t('mobileApp.hiding', { defaultValue: 'Hiding...' })
    : t('mobileApp.hide', { defaultValue: 'Hide' });

  const appStoreLabel = t('mobileApp.appStore', { defaultValue: 'App Store (iOS)' });
  const appStoreQrAlt = t('mobileApp.appStoreQrAlt', {
    defaultValue: 'QR code linking to the AlgaPSA app on the Apple App Store',
  });
  const playStoreLabel = t('mobileApp.playStore', { defaultValue: 'Google Play (Android)' });
  const playStoreQrAlt = t('mobileApp.playStoreQrAlt', {
    defaultValue: 'QR code linking to the AlgaPSA app on Google Play',
  });
  const connectServerLabel = t('mobileApp.connectServer', { defaultValue: 'Connect this server' });
  const connectServerQrAlt = t('mobileApp.connectServerQrAlt', {
    defaultValue: 'QR code that connects the AlgaPSA mobile app to this server',
  });
  const zoomAriaLabel = (label: string) =>
    t('mobileApp.zoomAria', { label, defaultValue: 'Enlarge the {{label}} QR code' });

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
        {selfHost
          ? t('mobileApp.selfHostDescription', {
              defaultValue:
                '1. Scan a store QR code to install the app. 2. In the app, tap "Change server" → "Scan QR code" and scan the "Connect this server" code.',
            })
          : t('mobileApp.description', {
              defaultValue: 'Scan a QR code with your phone to download the Alga PSA mobile app.',
            })}
      </p>
      <div className="flex flex-wrap items-start justify-center gap-12 py-2">
        <StoreLink
          url={APP_STORE_URL}
          label={appStoreLabel}
          qrAlt={appStoreQrAlt}
          qrDataUrl={iosQr}
          zoomId="zoom-app-store-qr"
          zoomAriaLabel={zoomAriaLabel(appStoreLabel)}
          onZoom={() => iosQr && setZoomedQr({ src: iosQr, label: appStoreLabel, alt: appStoreQrAlt })}
        />
        <StoreLink
          url={PLAY_STORE_URL}
          label={playStoreLabel}
          qrAlt={playStoreQrAlt}
          qrDataUrl={androidQr}
          zoomId="zoom-play-store-qr"
          zoomAriaLabel={zoomAriaLabel(playStoreLabel)}
          onZoom={() =>
            androidQr && setZoomedQr({ src: androidQr, label: playStoreLabel, alt: playStoreQrAlt })
          }
        />
        {selfHost ? (
          <div
            data-testid="connect-server-qr"
            className="relative flex flex-col items-center gap-2 rounded-md border border-slate-200 bg-white p-4"
          >
            {connectQr ? (
              <img
                src={connectQr}
                alt={connectServerQrAlt}
                width={160}
                height={160}
                className="h-40 w-40"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="h-40 w-40 animate-pulse rounded bg-slate-100" />
            )}
            <span className="text-sm font-medium text-slate-900">{connectServerLabel}</span>
            {connectQr ? (
              <ZoomQrButton
                id="zoom-connect-server-qr"
                ariaLabel={zoomAriaLabel(connectServerLabel)}
                onZoom={() =>
                  setZoomedQr({ src: connectQr, label: connectServerLabel, alt: connectServerQrAlt })
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {zoomedQr ? (
        <Dialog
          id="mobile-app-qr-zoom"
          isOpen
          onClose={() => setZoomedQr(null)}
          title={zoomedQr.label}
          className="max-w-lg"
          draggable={false}
        >
          <img
            src={zoomedQr.src}
            alt={zoomedQr.alt}
            className="mx-auto aspect-square w-full max-w-md"
            style={{ imageRendering: 'pixelated' }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}
