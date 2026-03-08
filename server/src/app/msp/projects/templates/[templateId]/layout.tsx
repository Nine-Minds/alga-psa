export async function generateMetadata() {
  return {
    title: 'Template Details',
  };
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

