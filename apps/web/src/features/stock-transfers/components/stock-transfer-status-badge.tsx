import { Badge } from '@/components/ui/badge';
import { STOCK_TRANSFER_STATUS_CLASSES, STOCK_TRANSFER_STATUS_LABELS } from '../labels';
import type { StockTransferStatus } from '../types';

export function StockTransferStatusBadge({ status }: { status: StockTransferStatus }): React.JSX.Element {
  return <Badge className={STOCK_TRANSFER_STATUS_CLASSES[status]}>{STOCK_TRANSFER_STATUS_LABELS[status]}</Badge>;
}
