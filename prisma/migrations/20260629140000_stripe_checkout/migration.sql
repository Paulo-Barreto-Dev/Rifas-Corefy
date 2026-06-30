-- Rename gateway-specific payment columns to generic provider fields
ALTER TABLE "Payment" RENAME COLUMN "pixTxId" TO "providerCheckoutSessionId";
ALTER TABLE "Payment" RENAME COLUMN "pixQrCode" TO "providerCheckoutUrl";
ALTER TABLE "Payment" RENAME COLUMN "pixExpiration" TO "providerExpiresAt";

-- Preserve existing unique constraint under the new generic name
ALTER INDEX "Payment_pixTxId_key" RENAME TO "Payment_providerCheckoutSessionId_key";

-- Add provider metadata required for Stripe Checkout and webhook reconciliation
ALTER TABLE "Payment"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'fake',
  ADD COLUMN "providerPaymentId" TEXT;

CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- Store webhook events for idempotent processing
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentId" TEXT,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentWebhookEvent_providerEventId_key" ON "PaymentWebhookEvent"("providerEventId");
CREATE INDEX "PaymentWebhookEvent_paymentId_idx" ON "PaymentWebhookEvent"("paymentId");
CREATE INDEX "PaymentWebhookEvent_provider_eventType_idx" ON "PaymentWebhookEvent"("provider", "eventType");
CREATE INDEX "PaymentWebhookEvent_processedAt_idx" ON "PaymentWebhookEvent"("processedAt");

ALTER TABLE "PaymentWebhookEvent"
  ADD CONSTRAINT "PaymentWebhookEvent_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
