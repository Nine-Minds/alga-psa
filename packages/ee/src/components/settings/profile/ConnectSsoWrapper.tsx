export default function ConnectSsoWrapper() {
  return (
    <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
      <p className="font-semibold text-foreground">Single Sign-On</p>
      <p>
        SSO account linking is available in the Enterprise Edition. Upgrade to connect your
        Google Workspace or Microsoft 365 account for seamless authentication.
      </p>
    </div>
  );
}
