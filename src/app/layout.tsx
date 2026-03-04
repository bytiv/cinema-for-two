import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'CinemaForTwo 🎬',
  description: 'Watch movies together, just the two of us',
  icons: { icon: '/icons/favicon.svg' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="film-grain stars-bg min-h-screen">
        {children}
      </body>
    </html>
  );
}
