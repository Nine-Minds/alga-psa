export async function generateMetadata() {
  return {
    title: 'Appointment Details',
  };
}

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

