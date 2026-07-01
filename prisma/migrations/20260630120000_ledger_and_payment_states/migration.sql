-- PaymentStatus: CONFIRMED -> APPROVED, add CANCELLED and EXPIRED
ALTER TYPE "PaymentStatus" RENAME VALUE 'CONFIRMED' TO 'APPROVED';
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';

-- FinancialTransactionType: migrate to ledger types
ALTER TYPE "FinancialTransactionType" RENAME VALUE 'SALE' TO 'PAYMENT_RECEIVED';
ALTER TYPE "FinancialTransactionType" RENAME VALUE 'PLATFORM_FEE' TO 'COMMISSION';
ALTER TYPE "FinancialTransactionType" RENAME VALUE 'CREATOR_EARNING' TO 'PRIZE';
ALTER TYPE "FinancialTransactionType" ADD VALUE 'WITHDRAWAL';

-- Restructure FinancialTransaction to user-centric ledger
ALTER TABLE "FinancialTransaction" ADD COLUMN "userId" TEXT;
ALTER TABLE "FinancialTransaction" ADD COLUMN "referenceId" TEXT;

UPDATE "FinancialTransaction"
SET
  "userId" = "creatorId",
  "referenceId" = "paymentId"
WHERE "userId" IS NULL;

ALTER TABLE "FinancialTransaction" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "FinancialTransaction" ALTER COLUMN "referenceId" SET NOT NULL;

ALTER TABLE "FinancialTransaction" ALTER COLUMN "paymentId" DROP NOT NULL;
ALTER TABLE "FinancialTransaction" ALTER COLUMN "raffleId" DROP NOT NULL;

-- Legacy CREATOR_EARNING rows (now PRIZE) are replaced by PAYMENT_RECEIVED + COMMISSION net
DELETE FROM "FinancialTransaction" WHERE "type" = 'PRIZE';

-- Commission debits must be negative in the ledger
UPDATE "FinancialTransaction"
SET "amountCents" = -ABS("amountCents")
WHERE "type" = 'COMMISSION';

-- Drop old foreign keys and columns
ALTER TABLE "FinancialTransaction" DROP CONSTRAINT IF EXISTS "FinancialTransaction_creatorId_fkey";
ALTER TABLE "FinancialTransaction" DROP CONSTRAINT IF EXISTS "FinancialTransaction_buyerId_fkey";

DROP INDEX IF EXISTS "FinancialTransaction_creatorId_idx";
DROP INDEX IF EXISTS "FinancialTransaction_buyerId_idx";

ALTER TABLE "FinancialTransaction" DROP COLUMN "creatorId";
ALTER TABLE "FinancialTransaction" DROP COLUMN "buyerId";

-- Add new indexes and constraints
CREATE INDEX "FinancialTransaction_userId_idx" ON "FinancialTransaction"("userId");
CREATE INDEX "FinancialTransaction_referenceId_idx" ON "FinancialTransaction"("referenceId");
CREATE UNIQUE INDEX "FinancialTransaction_userId_type_referenceId_key" ON "FinancialTransaction"("userId", "type", "referenceId");

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
