import { redirect } from 'next/navigation';
import MspSignIn from 'server/src/components/auth/MspSignIn';
import { getSession } from 'server/src/lib/auth/getSession';

export default async function MspSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/msp/dashboard';
  const session = await getSession();
  if (session?.user) {
    redirect(callbackUrl);
  }
  return <MspSignIn />;
}
