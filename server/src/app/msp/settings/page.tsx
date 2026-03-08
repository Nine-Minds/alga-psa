import SettingsPage from '@/components/settings/SettingsPage';


export const metadata = {
  title: 'Settings',
};

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const tab = typeof resolvedSearchParams?.tab === 'string' ? resolvedSearchParams.tab : undefined;
  return <SettingsPage initialTabParam={tab} />;
}
