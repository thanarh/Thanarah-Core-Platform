import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Observable } from 'rxjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONSTANTS } from '../constants/app.constants';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const requestId =
      (request.headers[APP_CONSTANTS.headers.requestId] as string | undefined) ?? randomUUID();

    request.headers[APP_CONSTANTS.headers.requestId] = requestId;
    void reply.header(APP_CONSTANTS.headers.requestId, requestId);

    return next.handle();
  }
}
