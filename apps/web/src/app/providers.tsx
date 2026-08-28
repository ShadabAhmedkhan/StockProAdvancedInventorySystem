'use client';

import { Toaster } from 'sonner';
import { AuthProvider } from '@/hooks/use-auth';
import { ThemeProvider, useTheme } from '@/hooks/use-theme';
import { QueryProvider } from '@/providers/query-provider';

function ThemedToaster(): React.JSX.Element {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme}
      position="top-right"
      toastOptions={{
        classNames: {
          toast: 'bg-surface! border-border! text-foreground! shadow-md!',
          title: 'text-foreground!',
          description: 'text-muted-foreground!',
          success: 'data-[type=success]:border-success/40!',
          error: 'data-[type=error]:border-danger/40!',
        },
      }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
        <ThemedToaster />
      </QueryProvider>
    </ThemeProvider>
  );
}
