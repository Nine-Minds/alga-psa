import { Theme } from '@radix-ui/themes';
import { I18nWrapper } from 'server/src/components/i18n/I18nWrapper';
import { getServerLocale } from 'server/src/lib/i18n/server';

export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();

  return (
    <Theme>
      <I18nWrapper portal="client" initialLocale={locale}>
        {children}
      </I18nWrapper>
    </Theme>
  );
}
