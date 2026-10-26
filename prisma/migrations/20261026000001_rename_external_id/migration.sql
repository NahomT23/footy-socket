-- The ingest migration created a snake_case column, but the `externalId`
-- Prisma field deliberately has no @map() (only providerKey is mapped), so the
-- physical name must be camelCase to match what Prisma Client generates.
ALTER TABLE "matches" RENAME COLUMN "external_id" TO "externalId";
