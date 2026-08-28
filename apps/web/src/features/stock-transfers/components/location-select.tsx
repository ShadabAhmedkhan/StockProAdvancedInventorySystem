'use client';

import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/ui/select';
import { locationsApi } from '@/features/locations/api';

interface LocationSelectProps {
  id: string;
  value: string;
  onChange: (locationId: string) => void;
  /** Excludes one location from the list - used so a transfer's destination cannot be picked as its own source and vice versa. */
  excludeId?: string;
}

export function LocationSelect({ id, value, onChange, excludeId }: LocationSelectProps): React.JSX.Element {
  const { data } = useQuery({ queryKey: ['locations-picker'], queryFn: () => locationsApi.list({ page: 1, search: '', includeDeleted: false }) });
  const locations = (data?.items ?? []).filter((location) => location.id !== excludeId);

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value="">Select a location</option>
      {locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.name}
        </option>
      ))}
    </Select>
  );
}
