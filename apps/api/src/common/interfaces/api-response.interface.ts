import type { ErrorCode } from '../enums/error-code.enum';

/** Metadata attached to every successful response. */
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

/** Envelope for every successful response: `{ data, meta }`. */
export interface ApiResponse<T> {
  data: T;
  meta: ResponseMeta;
}

/** A single failed field, produced by the global validation pipe. */
export interface ApiFieldError {
  field: string;
  constraints: string[];
}

/** Envelope for every error response. */
export interface ApiErrorResponse {
  statusCode: number;
  code: ErrorCode;
  message: string;
  errors?: ApiFieldError[];
  requestId: string;
  path: string;
  timestamp: string;
}
