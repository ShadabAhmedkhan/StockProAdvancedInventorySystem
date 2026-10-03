'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { setPlatformAdminSession } from '../api';

/** The token has no server-side session to revoke - forgetting it locally is the whole sign-out. */
export function PlatformSignOutButton(): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        setPlatformAdminSession(null, null);
        queryClient.removeQueries({ queryKey: ['platform-admin'] });
        router.replace('/platform/login');
      }}
    >
      <LogOut className="h-3.5 w-3.5" />
      Sign out
    </Button>
  );
}
