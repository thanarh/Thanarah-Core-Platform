import { APP_CONSTANTS } from '../common/constants/app.constants';

export function corsPolicyFor(nodeEnv: string): {
  origin: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  credentials: boolean;
} {
  return {
    origin: nodeEnv === 'development',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      APP_CONSTANTS.headers.requestId,
    ],
    exposedHeaders: [APP_CONSTANTS.headers.requestId],
    credentials: true,
  };
}
