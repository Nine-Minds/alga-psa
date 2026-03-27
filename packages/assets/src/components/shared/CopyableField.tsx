import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { cn } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface CopyableFieldProps {
  label: string;
  value: string | null | undefined;
  showCopyButton?: boolean;
  truncate?: boolean;
  copyId?: string;
}

export const CopyableField: React.FC<CopyableFieldProps> = ({
  label,
  value,
  showCopyButton = true,
  truncate = false,
  copyId,
}) => {
  const { t } = useTranslation('msp/assets');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (value) {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!value) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-sm text-gray-400">
          {t('common.states.na', { defaultValue: 'N/A' })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5 min-h-[20px]">
        <span className={cn(
          "text-sm text-gray-900",
          truncate && "truncate max-w-[150px]"
        )}>
          {value}
        </span>
        {showCopyButton && (
          <Tooltip
            content={copied
              ? t('copyableField.actions.copied', { defaultValue: 'Copied' })
              : t('copyableField.actions.copy', { defaultValue: 'Copy' })}
          >
            <Button
              id={`copy-${copyId ?? label.toLowerCase().replace(/\s+/g, '-')}`}
              variant="ghost"
              size="icon"
              className={cn(
                "h-5 w-5 p-0",
                copied ? "text-emerald-500" : "text-gray-400 hover:text-gray-600"
              )}
              onClick={handleCopy}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
