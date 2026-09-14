/**
 * InputValidator — Zod-based API Input Validation
 *
 * WHY: Currently all API routes do `req.body as { field: type }` — NO VALIDATION.
 *      Attacker can send: { price: -9999 } or { orderId: "'; DROP TABLE orders;" }
 *
 * vs World-class:
 *   Stripe API: returns precise validation errors per field
 *   Shopify API: GraphQL schema validation, specific error codes
 *   Auth0: strict email/password format validation
 *
 * Implementation: Zod schemas with Express middleware.
 * Returns consistent error format: { error, code, fields: [{field, message}] }
 */

import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

// ── Common schemas ────────────────────────────────────────────────────────────

export const Schemas = {
  // Auth
  register: z.object({
    email: z.string().email('Invalid email format').max(200),
    password: z.string().min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain uppercase letter')
      .regex(/[0-9]/, 'Must contain number'),
    name: z.string().min(2).max(100),
    phone: z.string().regex(/^\+880\d{10}$|^\+\d{7,15}$/, 'Invalid phone format').optional(),
    role: z.enum(['customer', 'vendor', 'rider']).default('customer'),
  }),

  login: z.object({
    email: z.string().email(),
    password: z.string().min(1),
    totpToken: z.string().length(6).optional(),
  }),

  passwordReset: z.object({
    email: z.string().email(),
  }),

  passwordResetConfirm: z.object({
    token: z.string().min(32).max(128),
    newPassword: z.string().min(8)
      .regex(/[A-Z]/, 'Must contain uppercase')
      .regex(/[0-9]/, 'Must contain number'),
  }),

  // Orders
  createOrder: z.object({
    items: z.array(z.object({
      productId: z.string().min(1).max(200),
      variantId: z.string().optional(),
      quantity: z.number().int().positive().max(1000),
    })).min(1).max(50),
    deliveryAddress: z.object({
      line1: z.string().min(5).max(300),
      line2: z.string().max(200).optional(),
      city: z.string().min(2).max(100),
      district: z.string().max(100).optional(),
      postalCode: z.string().max(20).optional(),
      country: z.string().length(2).default('BD'),
    }),
    paymentMethod: z.enum(['stripe', 'bkash', 'nagad', 'rocket', 'cod']),
    couponCode: z.string().max(50).optional(),
    loyaltyPointsToRedeem: z.number().int().min(0).max(100000).optional(),
    notes: z.string().max(500).optional(),
  }),

  // Payments
  bkashPayment: z.object({
    orderId: z.string().min(1),
    amount: z.number().positive().max(500000),
    currency: z.string().length(3).default('BDT'),
    payerReference: z.string().regex(/^\+880\d{10}$/, 'Invalid BKash number'),
  }),

  // Products
  createProduct: z.object({
    name: z.string().min(2).max(200),
    description: z.string().max(5000).optional(),
    price: z.number().positive().max(10000000),
    salePrice: z.number().positive().optional(),
    category: z.string().min(1).max(100),
    stock: z.number().int().min(0),
    sku: z.string().max(100).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    images: z.array(z.string().url()).max(10).optional(),
    isActive: z.boolean().default(true),
  }),

  // Reviews
  submitReview: z.object({
    productId: z.string().min(1),
    orderId: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    title: z.string().min(3).max(120),
    body: z.string().min(10).max(2000),
    mediaUrls: z.array(z.string().url()).max(5).optional(),
    tags: z.array(z.string().max(50)).max(5).optional(),
  }),

  // CSAT
  csatSubmit: z.object({
    type: z.enum(['order', 'support', 'return', 'general']),
    referenceId: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    nps: z.number().int().min(0).max(10).optional(),
    ces: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(1000).optional(),
    channel: z.string().max(50).optional(),
  }),

  // Campaign broadcast
  campaignBroadcast: z.object({
    recipients: z.array(z.object({
      customerId: z.string().min(1),
      preferredChannel: z.string().min(1),
      channelId: z.string().min(1),
      message: z.string().min(1).max(4096),
    })).min(1).max(10000),
  }),

  // COD fraud check
  codFraudCheck: z.object({
    orderId: z.string().min(1),
    userId: z.string().min(1),
    ipAddress: z.string().ip().optional().default('0.0.0.0'),
    phone: z.string().max(20),
    deliveryAddress: z.string().max(500),
    orderTotal: z.number().positive().max(500000),
    itemCount: z.number().int().positive(),
    isNewAccount: z.boolean(),
    accountAgeDays: z.number().int().min(0),
    userAgent: z.string().max(500).optional().default(''),
  }),

  // Feature flags
  updateFeatures: z.object({
    features: z.record(z.string(), z.boolean()),
  }),

  // Stock reservation
  reserveStock: z.object({
    productId: z.string().min(1),
    variantId: z.string().optional(),
    quantity: z.number().int().positive().max(1000),
    sessionId: z.string().min(1),
  }),

  // Tax calculation
  calculateTax: z.object({
    items: z.array(z.object({
      productId: z.string(),
      category: z.string(),
      price: z.number().positive(),
      quantity: z.number().int().positive(),
    })).min(1),
    country: z.string().length(2).default('BD'),
    customerVATNumber: z.string().max(50).optional(),
  }),
};

// ── Validation error format ────────────────────────────────────────────────

function formatZodError(error: ZodError): {
  error: string;
  code: 'VALIDATION_ERROR';
  fields: Array<{ field: string; message: string }>;
} {
  return {
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    fields: error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    })),
  };
}

// ── Middleware factory ────────────────────────────────────────────────────────

export function validate<T>(schema: ZodSchema<T>, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const result = schema.safeParse(data);

    if (!result.success) {
      res.status(400).json(formatZodError(result.error));
      return;
    }

    // Replace req source with validated+transformed data
    if (source === 'body') (req as Request & { validatedBody: T }).validatedBody = result.data;
    next();
  };
}

// ── Global sanitization middleware (all routes) ───────────────────────────────

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  // Remove null bytes (common SQL injection vector)
  const sanitize = (obj: unknown): unknown => {
    if (typeof obj === 'string') {
      return obj.replace(/\0/g, '').slice(0, 50000); // Hard limit
    }
    if (Array.isArray(obj)) return obj.map(sanitize).slice(0, 1000);
    if (obj && typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (Object.keys(sanitized).length < 200) { // Max 200 fields
          sanitized[k.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 100)] = sanitize(v);
        }
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  next();
}
