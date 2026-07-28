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

      return {
        status,
        code: (HttpStatus as unknown as Record<number, string>)[status] ?? 'HTTP_ERROR',
        message,
      };
    }

    if (exception instanceof Error) {
      this.logger.error({ requestId, stack: exception.stack }, exception.message);
    } else {
      this.logger.error({ requestId, exception }, 'Non-error exception thrown');
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
    };
  }
}
