'use client';

import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getTenantPortalLoginLink } from '@alga-psa/client-portal/actions/portal-actions/clientPortalLinkActions';

interface CopyClientPortalLinkButtonProps {
  id?: string;
  className?: string;
}

/**
 * Copies the tenant's portal sign-in URL — the vanity domain when one is live,
 * the slugged canonical address otherwise. Shared so the user list and the
 * client portal settings screen hand out exactly the same link.
 */
export const CopyClientPortalLinkButton = ({
  id = 'copy-client-portal-link-button',
  className,
}: CopyClientPortalLinkButtonProps) => {
  const { t } = useTranslation('msp/settings');
  const [isCopying, setIsCopying] = useState(false);

  const handleCopy = async (): Promise<void> => {
    if (isCopying) {
      return;
    }

    try {
      setIsCopying(true);
      const linkResult = await getTenantPortalLoginLink();
      if (linkResult.success === false) {
        toast.error(linkResult.error);
        return;
      }

      const portalLink = linkResult.data;
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(portalLink.url);
        toast.success(
          portalLink.source === 'vanity'
            ? t('users.messages.success.copiedVanityLink')
            : t('users.messages.success.copiedCanonicalLink')
        );
      } else {
        toast.error(t('users.messages.error.clipboardUnavailable'));
      }
    } catch (error) {
      handleError(error, t('users.messages.error.copyPortalLink'));
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Button
      id={id}
      variant="outline"
      className={className}
      onClick={handleCopy}
      disabled={isCopying}
    >
      {isCopying ? t('users.actions.copying') : t('users.actions.copyPortalLink')}
    </Button>
  );
};

export default CopyClientPortalLinkButton;
