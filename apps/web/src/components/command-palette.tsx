'use client';

import { CornerDownLeft, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { visibleNavLinks } from '@/components/dashboard-nav';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

/**
 * "Go to X" for every page the signed-in role can see, built from the same
 * `NAV_LINKS` the sidebar/nav bar renders - one definition, so a link added
 * there is searchable here for free, and a role restriction is enforced
 * identically in both places. The API itself is the real authorization
 * boundary regardless (a role-hidden command could never navigate to
 * anything the backend would actually serve), this list only decides what's
 * worth suggesting.
 */
function useCommands(): { label: string; href: string }[] {
  const { user } = useAuth();
  const links = React.useMemo(() => visibleNavLinks(user?.role ?? ''), [user?.role]);
  return React.useMemo(() => links.map((link) => ({ label: `Go to ${link.label}`, href: link.href })), [links]);
}

const MAX_RESULTS = 8;

export function CommandPalette(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const router = useRouter();
  const commands = useCommands();

  const results = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle === '' ? commands : commands.filter((command) => command.label.toLowerCase().includes(needle));
    return matches.slice(0, MAX_RESULTS);
  }, [commands, query]);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelected(0);
  }, []);

  const activate = React.useCallback(
    (index: number) => {
      const command = results[index];
      if (command === undefined) {
        return;
      }
      close();
      router.push(command.href);
    },
    [results, close, router],
  );

  // Global shortcut: Ctrl+K on every platform, Cmd+K on macOS. Registered
  // once for the whole dashboard rather than per-page, so it works no matter
  // where the user currently is.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function onQueryChange(value: string): void {
    setQuery(value);
    setSelected(0);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(selected);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-keyshortcuts="Control+K Meta+K"
        className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search or jump to...</span>
        <kbd className="ml-1 hidden rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </button>

      <dialog
        ref={dialogRef}
        onClose={close}
        onCancel={close}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            close();
          }
        }}
        aria-label="Command palette"
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-0 text-foreground shadow-md backdrop:bg-black/50"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search commands and pages..."
            aria-label="Command palette search"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching commands</li>}
          {results.map((command, index) => (
            <li key={command.href}>
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                onMouseEnter={() => {
                  setSelected(index);
                }}
                onClick={() => {
                  activate(index);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                  index === selected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                )}
              >
                {command.label}
                {index === selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
