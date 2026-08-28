import { Badge } from '@/components/ui/badge';
import { PURCHASE_ORDER_STATUS_CLASSES, PURCHASE_ORDER_STATUS_LABELS } from '../labels';
import type { PurchaseOrderStatus } from '../types';

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }): React.JSX.Element {
  return <Badge className={PURCHASE_ORDER_STATUS_CLASSES[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Badge>;
}
