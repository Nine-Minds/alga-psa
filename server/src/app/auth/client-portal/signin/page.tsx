import { redirect } from 'next/navigation';
import { auth } from 'server/src/app/api/auth/[...nextauth]/auth';
import ClientPortalSignIn from 'server/src/components/auth/ClientPortalSignIn';

export default async function ClientSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/client-portal/dashboard';
  const session = await auth();
  if (session?.user) {
    redirect(callbackUrl);
  }
  return <ClientPortalSignIn />;
}
