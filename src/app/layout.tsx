import type { Metadata } from 'next';
import { Playfair_Display, DM_Sans, JetBrains_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { AdminModeProvider } from '@/contexts/AdminModeContext';
import StarField from '@/components/layout/StarField';
import SpaceBackground from '@/components/layout/SpaceBackground';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700'],
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'CinemaForTwo',
  description: 'Watch movies together, just the two of us',
  icons: { icon: '/icons/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${playfair.variable} ${jetbrains.variable}`}>
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