"use client";

import React from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Dialog } from '@alga-psa/ui/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import type { AlertProps } from '@alga-psa/types';


const Alert: React.FC<AlertProps> = ({ type, title, message, isOpen, onClose }) => {
    const { t } = useTranslation('common');
    // Status tokens, not palette literals: white on bg-yellow-400 measured 1.53:1,
    // and the per-pair *-foreground tokens already carry a readable ink for each fill.
    const getAlertStyles = (): { bgColor: string; textColor: string; fgColor: string; hoverColor: string; icon: React.JSX.Element } => {
        switch (type) {
          case 'error':
            return { bgColor: 'bg-error', textColor: 'bg-error', fgColor: 'text-error-foreground', hoverColor: 'hover:opacity-90', icon: <AlertTriangle className="w-12 h-12 text-error-foreground" /> };
          case 'success':
            return { bgColor: 'bg-success', textColor: 'bg-success', fgColor: 'text-success-foreground', hoverColor: 'hover:opacity-90', icon: <CheckCircle2 className="w-12 h-12 text-success-foreground" /> };
          case 'warning':
            return { bgColor: 'bg-warning', textColor: 'bg-warning', fgColor: 'text-warning-foreground', hoverColor: 'hover:opacity-90', icon: <AlertTriangle className="w-12 h-12 text-warning-foreground" /> };
          default:
            return { bgColor: 'bg-muted', textColor: 'bg-[rgb(var(--color-text-600))]', fgColor: 'text-[rgb(var(--color-text-50))]', hoverColor: 'hover:bg-[rgb(var(--color-text-700))]', icon: <AlertTriangle className="w-12 h-12 text-[rgb(var(--color-text-500))]" /> };
        }
      };

      const { bgColor, textColor, fgColor, hoverColor, icon } = getAlertStyles();

      return (
        <Dialog
          isOpen={isOpen ?? false}
          onClose={onClose ?? (() => {})}
          hideCloseButton={true}
          draggable={false}
          contentClassName="!p-0"
          className="max-w-80"
          id="alert-dialog"
        >
          <div className="rounded-lg overflow-hidden min-w-52 w-full relative">
            <div className={`p-4 ${bgColor} relative`}>
              <button
                onClick={onClose}
                className={`absolute top-2 right-2 ${fgColor} hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-current focus:ring-opacity-50 rounded-full`}
                aria-label={t('common.close')}
              >
                <X className="h-6 w-6" />
              </button>
              <div className="flex justify-center">
                {icon}
              </div>
            </div>
            <div className="px-4 py-3 text-center">
                <h3 className="text-3xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-[rgb(var(--color-text-500))] break-words">{message}</p>
              <button
                onClick={onClose}
                className={`mt-4 px-4 py-1 text-sm font-medium ${fgColor} ${textColor} rounded-full ${hoverColor} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[rgb(var(--color-primary-500))]`}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </Dialog>
      );
};

export default Alert;
