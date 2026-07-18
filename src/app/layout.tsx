import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'منصة ستيب برو — التحضير لاختبار STEP',
  description: 'منصة التحضير لاختبار STEP للغة الإنجليزية',
};

export const viewport: Viewport = {
  themeColor: '#01589b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
