-- =============================================================================
-- MBOS — Hand-authored database constraints (Section 5)
--
-- NOT auto-run by Prisma. Prisma's schema language cannot express CHECK
-- constraints or partial unique indexes, so these live here and are applied as
-- a DEDICATED migration:
--
--   1. Set DATABASE_URL in backend/.env
--   2. npx prisma migrate dev --name init            (creates + applies base tables)
--   3. npx prisma migrate dev --create-only --name add_constraints
--   4. Paste the statements below into the new
--        prisma/migrations/<timestamp>_add_constraints/migration.sql
--   5. npx prisma migrate dev                          (applies the constraints)
--
-- Identifiers are quoted because Prisma preserves PascalCase table names and
-- camelCase columns verbatim (no @@map), and "Order" is a reserved word.
-- =============================================================================

-- Closed-set CHECK constraints. Columns are TEXT; these enforce the allowed
-- value sets the schema documents in comments (Section 5 lines 47, 213,
-- 314-316, 380, 439-442).
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_status_check"
  CHECK ("status" IN ('Active', 'Suspended', 'Cancelled'));

ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_status_check"
  CHECK ("status" IN ('Active', 'PastDue', 'Cancelled', 'Trialing'));

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_paymentMethod_check"
  CHECK ("paymentMethod" IN ('Cash', 'Card', 'Mobile'));

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_status_check"
  CHECK ("status" IN ('Pending', 'Completed', 'Refunded'));

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_status_check"
  CHECK ("status" IN ('Draft', 'Sent', 'Received', 'Cancelled'));

ALTER TABLE "StockAdjustment"
  ADD CONSTRAINT "StockAdjustment_type_check"
  CHECK ("type" IN ('ADD', 'REMOVE', 'COUNT'));

ALTER TABLE "StockAdjustment"
  ADD CONSTRAINT "StockAdjustment_reasonCode_check"
  CHECK ("reasonCode" IN ('Received', 'Damaged', 'Correction', 'Returned', 'Sale', 'PurchaseReceived'));

-- Numeric guards (Section 5 lines 340, 357, 401).
ALTER TABLE "OrderLine"
  ADD CONSTRAINT "OrderLine_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "POLine"
  ADD CONSTRAINT "POLine_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "RefundTransaction"
  ADD CONSTRAINT "RefundTransaction_amountCents_check"
  CHECK ("amountCents" > 0);

-- Exactly one default branch per tenant (Section 5 line 85).
CREATE UNIQUE INDEX "Branch_tenantId_default_key"
  ON "Branch" ("tenantId")
  WHERE "isDefault" = true;
