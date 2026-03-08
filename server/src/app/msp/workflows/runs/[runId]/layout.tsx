export async function generateMetadata() {
  return {
    title: 'Workflow Run',
  };
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

