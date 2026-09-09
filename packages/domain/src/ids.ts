import { z } from 'zod';

import type { Brand } from './brand.js';

export const ProductionIdSchema = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,63}$/)
  .transform((value) => value as Brand<string, 'ProductionId'>);

export type ProductionId = z.infer<typeof ProductionIdSchema>;
