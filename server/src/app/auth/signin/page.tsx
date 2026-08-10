import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('auth.signin.title', { defaultValue: 'Sign In' }),
  };
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '';

  const session = await getSession();
  if (session?.user) {
    redirect(callbackUrl || '/msp/dashboard');
  }

  const query = new URLSearchParams();
  if (callbackUrl) query.set('callbackUrl', callbackUrl);

  if (callbackUrl.includes('/client-portal')) {
    redirect(`/auth/client-portal/signin${query.toString() ? `?${query.toString()}` : ''}`);
  } else {
    redirect(`/auth/msp/signin${query.toString() ? `?${query.toString()}` : ''}`);
  }
}
