import { redirect } from 'next/navigation';

export default function SettingsIndex({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawTab = searchParams?.tab;
  const tab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  if (tab && tab.toLowerCase() === 'extensions') {
    redirect('/msp/settings/extensions');
  }
  // Default to extensions for now (EE focuses on Extensions settings)
  redirect('/msp/settings/extensions');
}

