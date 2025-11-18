import { Card } from "server/src/components/ui/Card";
import { AlertCircle } from "lucide-react";

interface ConnectSsoProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default function ConnectSso({ searchParams }: ConnectSsoProps) {
  // searchParams not used in CE stub
  return (
    <div className="container mx-auto max-w-2xl py-8">
      <Card className="p-8 text-center space-y-4">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Single Sign-On (Enterprise Only)</h1>
        <p className="text-muted-foreground">
          SSO account linking is available in the Enterprise Edition. Upgrade to manage Google Workspace
          or Microsoft 365 connections for your tenants.
        </p>
      </Card>
    </div>
  );
}
