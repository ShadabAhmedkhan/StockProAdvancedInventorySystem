import { Badge } from '@/components/ui/badge';
import { STOCK_COUNT_STATUS_CLASSES, STOCK_COUNT_STATUS_LABELS } from '../labels';
import type { StockCountStatus } from '../types';

export function StockCountStatusBadge({ status }: { status: StockCountStatus }): React.JSX.Element {
  return <Badge className={STOCK_COUNT_STATUS_CLASSES[status]}>{STOCK_COUNT_STATUS_LABELS[status]}</Badge>;
}
