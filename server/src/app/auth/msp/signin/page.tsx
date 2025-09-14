import { redirect } from 'next/navigation';
import { auth } from 'server/src/app/api/auth/[...nextauth]/auth';
import MspSignIn from 'server/src/components/auth/MspSignIn';

export default async function MspSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/msp/dashboard';
  const session = await auth();
  if (session?.user) {
    redirect(callbackUrl);
  }
  return <MspSignIn />;
}
