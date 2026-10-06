export const subscriptionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'planId',
    'status',
    'effectiveStatus',
    'startsAt',
    'endsAt',
    'cancelledAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    planId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'] },
    effectiveStatus: {
      type: 'string',
      enum: ['ACTIVE', 'SCHEDULED', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
      description:
        'Date-aware read state. A stored ACTIVE Subscription is current only between startsAt and endsAt.',
    },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time', nullable: true },
    cancelledAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const subscriptionListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'limit', 'offset'],
  properties: {
    items: { type: 'array', items: subscriptionResponseSchema },
    limit: { type: 'integer' },
    offset: { type: 'integer' },
  },
};

export const subscriptionErrorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error', 'requestId', 'timestamp'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
    requestId: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
  },
};
