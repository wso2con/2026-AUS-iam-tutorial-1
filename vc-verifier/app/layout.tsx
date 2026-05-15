import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkyLink Lounge Access',
  description: 'SkyLink lounge access verification demo',
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg'
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
