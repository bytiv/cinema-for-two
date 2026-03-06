import type { Metadata } from 'next';
import '@/styles/globals.css';
import { AdminModeProvider } from '@/contexts/AdminModeContext';
import StarField from '@/components/layout/StarField';
import SpaceBackground from '@/components/layout/SpaceBackground';

export const metadata: Metadata = {
  title: 'CinemaForTwo 🎬',
  description: 'Watch movies together, just the two of us',
  icons: { icon: '/icons/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ background: '#0f0a1a', color: '#f0e6f6' }}>
        {/* SpaceBackground: z-index -1, always behind everything */}
        <SpaceBackground />
        {/* Film grain only: z-index 1000, always on top */}
        <StarField />
        {/* No wrapper div — children render at natural stacking order (z-index auto) */}
        <AdminModeProvider>
          {children}
        </AdminModeProvider>
      </body>
    </html>
  );
}