'use client';

import React from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';

const QuotesTab: React.FC = () => {
  return (
    <Card size="2">
      <Box p="4">
        <Alert>
          <AlertTitle>Quotes</AlertTitle>
          <AlertDescription>
            Quote management is now wired into the billing dashboard and ready for the upcoming list, form, and detail views.
          </AlertDescription>
        </Alert>
      </Box>
    </Card>
  );
};

export default QuotesTab;
