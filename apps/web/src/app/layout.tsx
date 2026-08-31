import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google';
import { Providers } from './providers';
import { THEME_INIT_SCRIPT } from '@/hooks/use-theme';
import './globals.css';

const bodyFont = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-body' });
const displayFont = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'Stock Pro',
  description: 'Inventory, sales, repair, supplier, customer, return and finance management.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning className={`${bodyFont.variable} ${displayFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
