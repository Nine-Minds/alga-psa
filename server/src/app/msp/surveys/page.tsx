import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Surveys',
};

export default function SurveysIndexPage() {
  redirect('/msp/surveys/dashboard');
}
