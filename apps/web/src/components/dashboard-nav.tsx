'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

interface NavLink {
  href: string;
  label: string;
  /** Omit to show for every authenticated role. */
  roles?: readonly string[];
}

const NAV_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/orders', label: 'Orders' },
  { href: '/dashboard/repairs', label: 'Repairs' },
  { href: '/dashboard/returns', label: 'Returns' },
  { href: '/dashboard/products', label: 'Products' },
  { href: '/dashboard/inventory', label: 'Inventory' },
  { href: '/dashboard/customers', label: 'Customers' },
  { href: '/dashboard/suppliers', label: 'Suppliers' },
  { href: '/dashboard/finance', label: 'Finance' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/users', label: 'Users', roles: ['ADMIN', 'MANAGER'] },
  { href: '/dashboard/audit', label: 'Audit', roles: ['ADMIN'] },
  { href: '/dashboard/settings', label: 'Settings', roles: ['ADMIN', 'MANAGER'] },
];

export function DashboardNav(): React.JSX.Element {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const links = NAV_LINKS.filter((link) => link.roles === undefined || link.roles.includes(role));

  return (
    <nav className="flex gap-1 border-b border-border px-6">
      {links.map((link) => {
        const active = link.href === '/dashboard' ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              active ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
