import * as React from 'react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A thin wrapper around the native `<dialog>` element: it already gives us a
 * top-layer overlay, ESC-to-close and focus handling for free, so there is no
 * need for a portal/focus-trap library for something this simple.
 */
export function Dialog({ open, onClose, title, children, className }: DialogProps): React.JSX.Element {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose();
        }
      }}
      className={cn('w-full max-w-md rounded-md border border-border bg-background p-0 text-foreground backdrop:bg-black/50', className)}
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          &times;
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
