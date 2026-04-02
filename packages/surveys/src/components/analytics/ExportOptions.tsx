'use client';

import { Download, Mail, Share2 } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ExportOptionsProps = {
  onExportCsv?: () => void;
  onShareSnapshot?: () => void;
  onEmailDigest?: () => void;
};

export default function ExportOptions({
  onExportCsv,
  onShareSnapshot,
  onEmailDigest,
}: ExportOptionsProps) {
  const { t } = useTranslation('msp/surveys');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        id="export-csv"
        variant="outline"
        onClick={onExportCsv}
        className="flex items-center gap-2"
      >
        <Download className="h-4 w-4" />
        {t('analytics.export.csv', { defaultValue: 'Export CSV' })}
      </Button>
      <Button
        id="share-snapshot"
        variant="outline"
        onClick={onShareSnapshot}
        className="flex items-center gap-2"
      >
        <Share2 className="h-4 w-4" />
        {t('analytics.export.shareSnapshot', { defaultValue: 'Share Snapshot' })}
      </Button>
      <Button
        id="email-digest"
        variant="outline"
        onClick={onEmailDigest}
        className="flex items-center gap-2"
      >
        <Mail className="h-4 w-4" />
        {t('analytics.export.emailDigest', { defaultValue: 'Email Digest' })}
      </Button>
    </div>
  );
}
