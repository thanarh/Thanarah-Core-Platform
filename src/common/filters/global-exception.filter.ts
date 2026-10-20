import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorResponse } from '../types/response.types';
import { APP_CONSTANTS } from '../constants/app.constants';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId =
      (request.headers[APP_CONSTANTS.headers.requestId] as string | undefined) ?? 'unknown';

    const { status, code, message } = this.resolveException(exception, requestId);

    const body: ApiErrorResponse = {
      success: false,
      error: { code, message },
      requestId,
      timestamp: new Date().toISOString(),
    };

    void reply.status(status).send(body);
  }

  private resolveException(
    exception: unknown,
    requestId: string,
  ): { status: number; code: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      const message =
        typeof response === 'string'
          ? response
          : typeof (response as Record<string, unknown>).message === 'string'
            ? ((response as Record<string, unknown>).message as string)
            : exception.message;
      const code =
        typeof response === 'object' &&
        response !== null &&
        typeof (response as Record<string, unknown>).code === 'string'
          ? ((response as Record<string, unknown>).code as string)
          : ((HttpStatus as unknown as Record<number, string>)[status] ?? 'HTTP_ERROR');

      return {
        status,
        code,
        message,
      };
    }

    if (exception instanceof Error) {
      const dependencyCode = databaseDependencyCode(exception);
      if (dependencyCode) {
        this.logger.warn({ requestId, code: dependencyCode }, 'Database dependency unavailable');
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'DATABASE_UNAVAILABLE',
          message: 'A required database service is unavailable',
        };
      }

      this.logger.error(
        { requestId, errorType: safeErrorType(exception) },
        'Unhandled request error',
      );
    } else {
      this.logger.error({ requestId }, 'Non-error exception thrown');
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
    };
  }
}

const TRANSIENT_DATABASE_CODES = new Set([
  'P1001', // Cannot reach database server
  'P1002', // Database server timed out
  'P1008', // Operation timed out
  'P1017', // Database server closed the connection
  'P2024', // Connection pool timeout
]);

function databaseDependencyCode(error: Error): string | null {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_DATABASE_CODES.has(code) ? code : null;
}

function safeErrorType(error: Error): string {
  const name = error.name;
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) ? name : 'Error';
}
