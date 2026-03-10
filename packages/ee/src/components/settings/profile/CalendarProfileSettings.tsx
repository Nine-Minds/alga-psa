'use client';

export default function CalendarProfileSettings() {
  return (
    <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
      <p className="font-semibold text-foreground">Calendar</p>
      <p>
        Calendar sync is available in the Enterprise Edition. Upgrade to manage your connected
        Google or Microsoft calendar from your profile.
      </p>
    </div>
  );
}
