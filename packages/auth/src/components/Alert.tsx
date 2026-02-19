"use client";

import React from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Dialog } from '@alga-psa/ui/components';

import type { AlertProps } from '@alga-psa/types';


const Alert: React.FC<AlertProps> = ({ type, title, message, isOpen, onClose }) => {
    const getAlertStyles = (): { bgColor: string; textColor: string; hoverColor: string; icon: React.JSX.Element } => {
        switch (type) {
          case 'error':
            return { bgColor: 'bg-rose-500', textColor: 'bg-rose-500', hoverColor: 'hover:bg-rose-700', icon: <AlertTriangle className="w-12 h-12 text-white" /> };
          case 'success':
            return { bgColor: 'bg-green-500', textColor: 'bg-green-500', hoverColor: 'hover:bg-green-700', icon: <CheckCircle2 className="w-12 h-12 text-white" /> };
          case 'warning':
            return { bgColor: 'bg-yellow-400', textColor: 'bg-yellow-400', hoverColor: 'hover:bg-yellow-700', icon: <AlertTriangle className="w-12 h-12 text-white" /> };
          default:
            return { bgColor: 'bg-muted', textColor: 'bg-[rgb(var(--color-text-600))]', hoverColor: 'hover:bg-[rgb(var(--color-text-700))]', icon: <AlertTriangle className="w-12 h-12 text-[rgb(var(--color-text-500))]" /> };
        }
      };

      const { bgColor, textColor, hoverColor, icon } = getAlertStyles();

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
                className="absolute top-2 right-2 text-white hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 rounded-full"
                aria-label="Close"
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
                className={`mt-4 px-4 py-1 text-sm font-medium text-white ${textColor} rounded-full ${hoverColor} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
              >
                Close
              </button>
            </div>
          </div>
        </Dialog>
      );
};

export default Alert;
