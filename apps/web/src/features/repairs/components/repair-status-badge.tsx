import { Badge } from '@/components/ui/badge';
import { REPAIR_STATUS_CLASSES, REPAIR_STATUS_LABELS } from '../labels';
import type { RepairStatus } from '../types';

export function RepairStatusBadge({ status }: { status: RepairStatus }): React.JSX.Element {
  return <Badge className={REPAIR_STATUS_CLASSES[status]}>{REPAIR_STATUS_LABELS[status]}</Badge>;
}
