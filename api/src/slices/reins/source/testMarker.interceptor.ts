import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * TEMPORARY. Prefixes every error this controller returns with a fixed
 * marker, so hitting the endpoint tells you at a glance whether the running
 * image actually contains the current build - an unmarked error means the
 * deploy did not land. Remove once the storage config on dev is settled.
 *
 * Route-scoped interceptors unwind before the global `ErrorHandlingInterceptor`,
 * so the marker is already in place by the time that one builds the 500 body.
 */
export const TEST_MARKER = '(For test)';

@Injectable()
export class TestMarkerInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(catchError((error: unknown) => throwError(() => mark(error))));
  }
}

function mark(error: unknown): unknown {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const body = error.getResponse();
    if (typeof body === 'string') {
      return new HttpException(`${TEST_MARKER} ${body}`, status);
    }
    const record = body as Record<string, unknown>;
    const message = record.message;
    // class-validator reports a string[]; keep the shape so clients that
    // iterate the list don't break on a suddenly-scalar message.
    const marked = Array.isArray(message)
      ? [TEST_MARKER, ...(message as unknown[])]
      : `${TEST_MARKER} ${typeof message === 'string' ? message : error.message}`;
    return new HttpException({ ...record, message: marked }, status);
  }

  if (error instanceof Error) {
    error.message = `${TEST_MARKER} ${error.message}`;
    return error;
  }
  return new Error(`${TEST_MARKER} ${String(error)}`);
}
