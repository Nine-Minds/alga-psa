import LocalDrawerOutlet from '../_components/LocalDrawerOutlet';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export default function SettingsLayout({ children }: Readonly<SettingsLayoutProps>) {
  return (
    <>
      {children}
      <LocalDrawerOutlet />
    </>
  );
}
