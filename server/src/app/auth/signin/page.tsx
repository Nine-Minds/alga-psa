import { redirect } from 'next/navigation';
import { auth } from 'server/src/app/api/auth/[...nextauth]/auth';

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '';

  const session = await auth();
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
