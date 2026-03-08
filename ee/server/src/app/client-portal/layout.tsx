export const metadata = {
  title: {
    template: '%s | Client Portal',
    default: 'Dashboard | Client Portal',
  },
};

export default function ClientPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
