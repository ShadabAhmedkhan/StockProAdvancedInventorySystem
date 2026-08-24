import { Badge } from '@/components/ui/badge';
import { RETURN_STATUS_CLASSES, RETURN_STATUS_LABELS } from '../labels';
import type { ReturnStatus } from '../types';

export function ReturnStatusBadge({ status }: { status: ReturnStatus }): React.JSX.Element {
  return <Badge className={RETURN_STATUS_CLASSES[status]}>{RETURN_STATUS_LABELS[status]}</Badge>;
}
