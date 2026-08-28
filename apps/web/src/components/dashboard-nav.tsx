'use client';

import {
  LayoutDashboard,
  ShoppingCart,
  Wrench,
  Undo2,
  Package,
  Boxes,
  Users,
  Truck,
  ClipboardList,
  MapPin,
  ArrowLeftRight,
  Wallet,
  BarChart3,
  UserCog,
  ScrollText,
  Settings,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Omit to show for every authenticated role. */
  roles?: readonly string[];
}

/** Exported so the command palette's "Go to X" commands share one definition with the nav bar, rather than a second hand-kept list drifting out of sync. */
export const NAV_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/dashboard/repairs', label: 'Repairs', icon: Wrench },
  { href: '/dashboard/returns', label: 'Returns', icon: Undo2 },
  { href: '/dashboard/products', label: 'Products', icon: Package },
  { href: '/dashboard/inventory', label: 'Inventory', icon: Boxes },
  { href: '/dashboard/customers', label: 'Customers', icon: Users },
  { href: '/dashboard/suppliers', label: 'Suppliers', icon: Truck },
  { href: '/dashboard/purchase-orders', label: 'Purchase orders', icon: ClipboardList, roles: ['ADMIN', 'MANAGER'] },
  { href: '/dashboard/locations', label: 'Locations', icon: MapPin, roles: ['ADMIN', 'MANAGER'] },
  { href: '/dashboard/stock-transfers', label: 'Stock transfers', icon: ArrowLeftRight, roles: ['ADMIN', 'MANAGER'] },
  { href: '/dashboard/finance', label: 'Finance', icon: Wallet },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3 },
  { href: '/dashboard/users', label: 'Users', icon: UserCog, roles: ['ADMIN', 'MANAGER'] },
  { href: '/dashboard/audit', label: 'Audit', icon: ScrollText, roles: ['ADMIN'] },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings, roles: ['ADMIN', 'MANAGER'] },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard, roles: ['ADMIN'] },
];

/** The subset of {@link NAV_LINKS} a given role may see - shared by the nav bar and the command palette. */
export function visibleNavLinks(role: string): NavLink[] {
  return NAV_LINKS.filter((link) => link.roles === undefined || link.roles.includes(role));
}

export function DashboardNav(): React.JSX.Element {
  const pathname = usePathname();
  const { user } = useAuth();
  const links = visibleNavLinks(user?.role ?? '');

  return (
    <nav className="scrollbar-none flex gap-1 overflow-x-auto border-b border-border bg-surface px-4">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
