import { Badge } from '@/components/ui/badge';
import { STOCK_STATUS_CLASSES, STOCK_STATUS_LABELS } from '../labels';
import type { StockStatus } from '../types';

export function StockStatusBadge({ status }: { status: StockStatus }): React.JSX.Element {
  return <Badge className={STOCK_STATUS_CLASSES[status]}>{STOCK_STATUS_LABELS[status]}</Badge>;
}
