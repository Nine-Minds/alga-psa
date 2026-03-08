export const metadata = {
  title: {
    template: '%s | Alga PSA',
    default: 'Alga PSA',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
