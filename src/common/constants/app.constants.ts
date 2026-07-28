export const APP_CONSTANTS = {
  name: 'Thanarah',
  version: '0.1.0',
  apiPrefix: 'api',
  swagger: {
    title: 'Thanarah API',
    description: 'Thanarah backend platform — API reference',
    version: '0.1.0',
    path: 'docs',
  },
  headers: {
    requestId: 'x-request-id',
    correlationId: 'x-correlation-id',
  },
} as const;
