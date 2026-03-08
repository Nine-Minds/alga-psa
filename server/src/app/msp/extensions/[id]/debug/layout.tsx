export async function generateMetadata() {
  return {
    title: 'Extension Debug',
  };
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

