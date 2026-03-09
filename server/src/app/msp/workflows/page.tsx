import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Workflows',
};

export default function LegacyWorkflowsPage() {
  notFound();
}
