'use client';
import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Copy, Timer } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
export function TotpCode({ code, secondsRemaining, isRefreshing = false, onCopy, idPrefix = 'credentials-totp' }: { code: string; secondsRemaining: number; isRefreshing?: boolean; onCopy?: () => void; idPrefix?: string }) { const { t } = useTranslation('msp/credentials'); return <span id={`${idPrefix}-countdown`} data-code={code} data-seconds-remaining={secondsRemaining} className="flex items-center gap-2 rounded bg-[rgb(var(--color-background))] px-2 py-1 text-sm"><Timer className="h-3.5 w-3.5" /><code id={`${idPrefix}-code`} className="font-mono">{code}</code><span className="text-xs text-[rgb(var(--color-text-500))]">{t('credentials.otp.expires', { seconds: secondsRemaining })}</span>{onCopy && <Button id={`${idPrefix}-copy`} variant="ghost" size="sm" onClick={onCopy} disabled={isRefreshing}><Copy className="h-3.5 w-3.5" />{t('credentials.otp.copy')}</Button>}</span>; }
