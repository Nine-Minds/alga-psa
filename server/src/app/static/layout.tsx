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
