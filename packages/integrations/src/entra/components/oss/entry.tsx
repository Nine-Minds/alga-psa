import React from 'react';
import { Card, CardContent } from '@alga-psa/ui/components/Card';

const EnterpriseOnlyNotice = () => (
    <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
            Microsoft Entra Identity Integration is a Pro Feature.
        </CardContent>
    </Card>
);

export const EntraIntegrationPage = (_props: { canUseCipp?: boolean }) => <EnterpriseOnlyNotice />;

export const EntraIntegrationSummaryCard = () => <EnterpriseOnlyNotice />;
