import { Badge } from '@/components/ui/badge';
import { displayStatus, STATUS_CLASSES, STATUS_LABELS } from '../labels';
import type { PlatformOrganizationSummary } from '../types';

export function OrganizationStatusBadge({
  organization,
}: {
  organization: Pick<PlatformOrganizationSummary, 'subscriptionStatus' | 'trialEndsAt'>;
}): React.JSX.Element {
  const status = displayStatus(organization);
  return <Badge className={STATUS_CLASSES[status]}>{STATUS_LABELS[status]}</Badge>;
}
