import { Badge } from '@/components/ui/badge';
import { ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS, PAYMENT_STATUS_CLASSES, PAYMENT_STATUS_LABELS } from '../labels';
import type { OrderStatus, PaymentStatus } from '../types';

export function OrderStatusBadge({ status }: { status: OrderStatus }): React.JSX.Element {
  return <Badge className={ORDER_STATUS_CLASSES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }): React.JSX.Element {
  return <Badge className={PAYMENT_STATUS_CLASSES[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}
