'use client';

import React from 'react';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const EnterpriseOnlyNotice = () => {
    const { t } = useTranslation('msp/integrations');

    return (
        <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
                {t('integrations.entra.proFeature.notice')}
            </CardContent>
        </Card>
    );
};

export const EntraIntegrationPage = (_props: { canUseCipp?: boolean }) => <EnterpriseOnlyNotice />;

export const EntraIntegrationSummaryCard = () => <EnterpriseOnlyNotice />;
