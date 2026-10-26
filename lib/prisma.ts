/**
 * Prisma client singleton.
 *
 * Next.js hot-reloads modules in development; without caching the client on
 * `globalThis` every reload opens a new connection pool and PostgreSQL runs out
 * of connections.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
