import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Test Routing',
};

export default function TestPage() {
  return <div>Test routing works!</div>;
}
