import React from 'react';
import { ExtensionRouter } from '../../lib/extensions/routing/ExtensionRouter';
import { ExtensionProvider } from '../../lib/extensions/ExtensionProvider';

/**
 * Dynamic catch-all route for extension pages
 * Handles URLs like:
 * - /ext/softwareone/settings
 * - /ext/softwareone/agreements
 * - /ext/softwareone/agreements/123
 */
export default function ExtensionPage() {
  return (
    <ExtensionProvider>
      <ExtensionRouter basePath="/ext" />
    </ExtensionProvider>
  );
}

// Enable dynamic routing
export async function getServerSideProps() {
  return {
    props: {}
  };
}