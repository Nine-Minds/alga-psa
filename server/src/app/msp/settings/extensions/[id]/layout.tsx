export async function generateMetadata() {
  return {
    title: 'Extension Settings',
  };
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

