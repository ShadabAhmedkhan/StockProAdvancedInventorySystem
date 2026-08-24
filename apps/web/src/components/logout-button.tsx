'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';

export function LogoutButton(): React.JSX.Element {
  const { logout } = useAuth();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout(): Promise<void> {
    setIsSubmitting(true);
    try {
      await logout();
      router.replace('/login');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isSubmitting}
      onClick={() => {
        void handleLogout();
      }}
    >
      {isSubmitting ? 'Signing out...' : 'Sign out'}
    </Button>
  );
}
