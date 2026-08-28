export interface EntityBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'textarea' | 'select';
  /** Required when type is 'select'. */
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
}

export interface ListParams {
  page: number;
  search: string;
  includeDeleted: boolean;
}

export interface PaginatedList<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface EntityApi<T> {
  list: (params: ListParams) => Promise<PaginatedList<T>>;
  create: (values: Record<string, string>) => Promise<T>;
  update: (id: string, values: Record<string, string>) => Promise<T>;
  remove: (id: string) => Promise<T>;
  restore: (id: string) => Promise<T>;
}
