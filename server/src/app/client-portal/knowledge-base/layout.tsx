import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Knowledge Base',
};

export default function ClientPortalKnowledgeBaseLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
