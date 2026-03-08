import { redirect } from 'next/navigation';


export const metadata = {
  title: 'Surveys',
};

export default function SurveysIndexPage() {
  redirect('/msp/surveys/dashboard');
}
