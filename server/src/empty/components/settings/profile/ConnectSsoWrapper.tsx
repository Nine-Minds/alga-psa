"use client";

import { Card } from "server/src/components/ui/Card";
import { AlertCircle } from "lucide-react";

export default function ConnectSsoWrapper() {
  return (
    <Card className="p-8 text-center space-y-4">
      <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">Single Sign-On (Enterprise Only)</h1>
      <p className="text-muted-foreground">
        SSO account linking is available in the Enterprise Edition. Upgrade to connect your
        Google Workspace or Microsoft 365 account for seamless authentication.
      </p>
    </Card>
  );
}
