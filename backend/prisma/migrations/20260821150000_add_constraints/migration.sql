-- Hand-authored constraints Prisma's schema language cannot express (Section 5).
-- Applied as a tracked migration so a fresh DB reproduces them.

-- Closed-set CHECK constraints (Section 5 lines 47, 213, 314-316, 380, 439-442).
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
