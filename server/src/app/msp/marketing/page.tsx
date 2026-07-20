import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Marketing',
};

export default function MarketingPage() {
  redirect('/msp/marketing/calendar');
}
