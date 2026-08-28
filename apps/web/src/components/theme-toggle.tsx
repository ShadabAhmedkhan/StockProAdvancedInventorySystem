'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Match system theme', icon: Monitor },
];

export function ThemeToggle(): React.JSX.Element {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center rounded-full border border-border bg-muted p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => {
            setTheme(value);
          }}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
            theme === value ? 'bg-surface text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
