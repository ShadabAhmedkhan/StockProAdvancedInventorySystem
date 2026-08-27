import type { Metadata } from 'next';
import { Providers } from './providers';
import { THEME_INIT_SCRIPT } from '@/hooks/use-theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stock Pro',
  description: 'Inventory, sales, repair, supplier, customer, return and finance management.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
