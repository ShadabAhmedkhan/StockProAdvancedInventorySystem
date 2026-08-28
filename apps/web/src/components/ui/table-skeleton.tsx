import { Skeleton } from './skeleton';

export function TableSkeleton({ rows = 5 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
