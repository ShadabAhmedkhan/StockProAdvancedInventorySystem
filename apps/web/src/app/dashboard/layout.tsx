'use client';

import { Boxes } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DashboardNav } from '@/components/dashboard-nav';
import { LogoutButton } from '@/components/logout-button';
import { ThemeToggle } from '@/components/theme-toggle';
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

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-3 shadow-xs">
        <span className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Boxes className="h-4 w-4" />
          </span>
          Stock Pro
        </span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="flex items-center gap-2 rounded-full border border-border bg-muted py-1 pl-1 pr-3 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {initials}
            </span>
            <span className="text-muted-foreground">
              {user.firstName} {user.lastName} &middot; {user.role}
            </span>
          </div>
          <LogoutButton />
        </div>
      </header>
      <div className="sticky top-[57px] z-10">
        <DashboardNav />
      </div>
      <main className="animate-in mx-auto max-w-[1600px] p-6">{children}</main>
    </div>
  );
}
