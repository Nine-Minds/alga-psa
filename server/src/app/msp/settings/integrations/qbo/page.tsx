// server/src/app/msp/settings/integrations/qbo/page.tsx
import React from 'react';
import { getQboConnectionStatus } from 'server/src/lib/actions/integrations/qboActions'; // Assuming this returns { connected: boolean, realmId?: string }
import QboIntegrationClient from './QboIntegrationClient'; // Client component for interactions
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card'; // Corrected path by user
import { QboMappingManager } from 'server/src/components/integrations/qbo/QboMappingManager'; // Import the new mapping manager
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions'; // Import getCurrentUser

// TODO: Verify the return type of getQboConnectionStatus. Assuming { connected: boolean, realmId?: string }

export default async function QboIntegrationPage() {
  // Fetch connection status
  const connectionStatus = await getQboConnectionStatus();
  // Fetch current user to get tenant context
  const user = await getCurrentUser();

  // Ensure tenant context is available if needed for mapping
  const tenantId = user?.tenant;

  return (
    <div className="space-y-6"> {/* Added a container div */}
      <Card>
        <CardHeader>
          <CardTitle>QuickBooks Online Integration</CardTitle>
          <CardDescription>
            Connect or disconnect your QuickBooks Online account to sync data with Alga PSA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Pass initial status to the client component for connection management */}
          <QboIntegrationClient initialStatus={connectionStatus} />
        </CardContent>
      </Card>

      {/* Conditionally render the Mapping Manager if connected and realmId/tenant are available */}
      {connectionStatus.connected && connectionStatus.realmId && tenantId && ( // Check tenantId from user
        <Card id="qbo-mapping-card"> {/* Added ID */}
          <CardHeader>
            <CardTitle>QuickBooks Online Mappings</CardTitle>
            <CardDescription>
              Map your Alga entities (Services, Tax Regions, Payment Terms) to their QuickBooks Online counterparts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QboMappingManager
              realmId={connectionStatus.realmId}
              tenantId={tenantId} // Pass tenantId from user
            />
          </CardContent>
        </Card>
      )}

      {/* Optional: Show a message if connected but missing realmId/tenant (configuration issue) */}
      {connectionStatus.connected && (!connectionStatus.realmId || !tenantId) && ( // Check tenantId from user
         <Card>
           <CardContent>
             <p className="text-orange-600">
               QuickBooks Online is connected, but configuration details (Realm ID or Tenant ID) are missing. Please contact support.
             </p>
           </CardContent>
         </Card>
      )}
    </div>
  );
}