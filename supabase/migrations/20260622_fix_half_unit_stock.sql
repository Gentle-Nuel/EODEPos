-- Migration: fix half-unit stock deduction
-- Problem: products.stock_quantity is INTEGER, so (e.g.) 10 - 0.5 = 9.5, which
-- PostgreSQL rounds back to 10 when storing into the INTEGER column — meaning
-- half-unit sales never decrement stock. sale_items.quantity has the same issue
-- (0.5 coerces to 1). The trigger also referenced NEW.quantity instead of
-- NEW.units_deducted, so carton quantities were also wrong.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

BEGIN;

-- 1. Allow fractional stock on products
ALTER TABLE products
  ALTER COLUMN stock_quantity TYPE NUMERIC(10,2)
  USING stock_quantity::NUMERIC(10,2);

-- 2. Allow fractional quantity on sale_items (0.5 for half-unit sales)
ALTER TABLE sale_items
  ALTER COLUMN quantity TYPE NUMERIC(10,2)
  USING quantity::NUMERIC(10,2);

-- 3. Fix the trigger to deduct units_deducted (not quantity).
--    units_deducted is what the app sends: qty for unit/half sales,
--    qty * units_per_carton for carton sales.
CREATE OR REPLACE FUNCTION decrement_stock_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity - NEW.units_deducted
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger binding stays the same (CREATE OR REPLACE FUNCTION is enough).
-- If trigger on_sale_item_inserted doesn't exist yet, create it:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_sale_item_inserted'
      AND tgrelid = 'sale_items'::regclass
  ) THEN
    EXECUTE '
      CREATE TRIGGER on_sale_item_inserted
        AFTER INSERT ON sale_items
        FOR EACH ROW EXECUTE FUNCTION decrement_stock_on_sale()
    ';
  END IF;
END;
$$;

COMMIT;
