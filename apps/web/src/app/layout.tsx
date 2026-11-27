import type { Metadata, Viewport } from 'next';
import {
  Atkinson_Hyperlegible,
  Fraunces,
  JetBrains_Mono,
  Noto_Sans_Devanagari,
  Noto_Sans_Kannada,
} from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

const atkinson = Atkinson_Hyperlegible({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-atkinson',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const notoKannada = Noto_Sans_Kannada({
  subsets: ['kannada'],
  weight: ['400', '700'],
  variable: '--font-kannada',
  display: 'swap',
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '700'],
  variable: '--font-devanagari',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Sachet · SENTINEL — Wearable Early-Awareness Platform',
  description:
    'Personal physiological baselines, deterministic anomaly detection, and calm caregiver escalation for elderly and chronic care.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1b3c53' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1218' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${atkinson.variable} ${jetbrainsMono.variable} ${notoKannada.variable} ${notoDevanagari.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
