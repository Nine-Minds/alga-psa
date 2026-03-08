export async function generateMetadata() {
  return {
    title: 'Extension Configuration',
  };
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

