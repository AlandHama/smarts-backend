import type { ReactNode } from 'react';

import './globals.css';

export const metadata = {
  title: 'SMARTS Control Center',
  description: 'System administration for SMARTS players and economy',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

