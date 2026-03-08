import { notFound } from 'next/navigation';


export async function generateMetadata() {
  return {
    title: 'Response Details',
  };
}

export default function SurveyResponseDetailPage() {
  // Detailed response views will be handled via drawers/modals from the responses dashboard.
  // Until then we can surface a 404 to avoid half-baked routes.
  return notFound();
}
