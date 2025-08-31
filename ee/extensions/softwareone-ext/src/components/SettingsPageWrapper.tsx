import React from 'react';
import { Card, Text } from '@alga/ui-kit';

interface SettingsPageWrapperProps {
  extensionId: string;
  [key: string]: any;
}

/**
 * Wrapper component that adapts the SettingsPage to work with the extension system
 * This component receives props from the ExtensionRenderer and creates the context
 */
export const SettingsPageWrapper: React.FC<SettingsPageWrapperProps> = () => {
  // Placeholder until descriptor-driven settings are wired to handlers.
  return (
    <Card>
      <div style={{ padding: 16 }}>
        <Text as="p">SoftwareOne Settings page is provided via descriptors.</Text>
        <Text as="p" tone="muted">Editable settings are not implemented in this demo component.</Text>
      </div>
    </Card>
  );
};

export default SettingsPageWrapper;
