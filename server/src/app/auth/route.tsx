import { redirect } from 'next/navigation';

export async function GET() {
  redirect('/auth/msp/signin');
}
