export const metadata = {
  title: {
    default: 'Alga PSA',
  },
};

export default function StaticLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="static-pages">
      {children}
    </div>
  );
}
