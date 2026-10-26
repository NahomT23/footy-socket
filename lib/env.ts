/**
 * Runtime environment parsing.
 *
 * Validated once at module load so a misconfigured server fails loudly on boot
 * instead of throwing an opaque Prisma error on the first request.
 */
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (see .env.example)")
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL connection string"
    ),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /**
   * Requests per minute allowed on each mutation endpoint.
   *
   * The defaults suit a real client. The simulation engine is a deliberately
   * chatty client — it drives ten fixtures at once — so a developer running
   * `npm run seed` against a local server raises these in `.env`. They stay a
   * hard ceiling either way: the guard exists to bound abuse, not to shape
   * normal traffic.
   */
  RATE_LIMIT_MATCH_CREATE: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_SCORE: z.coerce.number().int().min(1).default(240),
  RATE_LIMIT_COMMENTARY: z.coerce.number().int().min(1).default(600),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  RATE_LIMIT_MATCH_CREATE: process.env.RATE_LIMIT_MATCH_CREATE,
  RATE_LIMIT_SCORE: process.env.RATE_LIMIT_SCORE,
  RATE_LIMIT_COMMENTARY: process.env.RATE_LIMIT_COMMENTARY,
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
