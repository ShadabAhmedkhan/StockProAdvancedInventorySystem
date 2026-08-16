import { BadRequestException, type ValidationError } from '@nestjs/common';
import { ErrorCode } from '../enums/error-code.enum';
import type { ApiFieldError } from '../interfaces/api-response.interface';

/** Flattens class-validator's nested error tree into `field -> constraints` pairs. */
function flattenValidationErrors(errors: ValidationError[], parentPath = ''): ApiFieldError[] {
  const flattened: ApiFieldError[] = [];

  for (const error of errors) {
    const field = parentPath === '' ? error.property : `${parentPath}.${error.property}`;

    if (error.constraints !== undefined) {
      flattened.push({ field, constraints: Object.values(error.constraints) });
    }

    if (error.children !== undefined && error.children.length > 0) {
      flattened.push(...flattenValidationErrors(error.children, field));
    }
  }

  return flattened;
}

/**
 * Turns validation failures into the standard error envelope. The message is
 * deliberately generic; the per-field detail lives in `errors`.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.VALIDATION_ERROR,
    message: 'Validation failed',
    errors: flattenValidationErrors(errors),
  });
}
