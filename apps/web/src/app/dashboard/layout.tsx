'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DashboardNav } from '@/components/dashboard-nav';
import { LogoutButton } from '@/components/logout-button';
import { useAuth } from '@/hooks/use-auth';

/**
 * The sole guard for protected routes. A `proxy.ts` middleware redirect was
 * tried and removed: the refresh cookie is deliberately scoped to
 * `/api/v1/auth` (see `REFRESH_COOKIE_PATH`) so it is never attached to a
 * request for `/dashboard` on the frontend's own origin, which made that
 * middleware redirect logged-in users back to `/login` every time. The
 * client already holds the true session state from `AuthProvider`'s
 * `/auth/refresh` call (made directly against the API origin, where the
 * cookie's path does match), so it is both necessary and sufficient here.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user === null) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading || user === null) {
    return null;
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <span className="font-semibold">Stock Pro</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {user.firstName} {user.lastName} &middot; {user.role}
          </span>
          <LogoutButton />
        </div>
      </header>
      <DashboardNav />
      <main className="p-6">{children}</main>
    </div>
  );
}
