-- Migration: Admin delete-sale (with stock restore) + product price groups
-- Run in Supabase Dashboard → SQL Editor

BEGIN;

-- ── Feature 1: Admin delete sale ─────────────────────────────────────────────

-- 1a. Restore product stock when a sale_item row is deleted.
--     The cascade from deleting a sale fires this for every line item.
CREATE OR REPLACE FUNCTION restore_stock_on_sale_item_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity + OLD.units_deducted
  WHERE id = OLD.product_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_sale_item_deleted
  BEFORE DELETE ON sale_items
  FOR EACH ROW EXECUTE FUNCTION restore_stock_on_sale_item_delete();

-- 1b. Allow admins to delete sales (cascade handles sale_items automatically).
CREATE POLICY "sales: admin delete"
  ON sales FOR DELETE USING (is_admin());

-- ── Feature 2: Product price groups ──────────────────────────────────────────

-- 2a. Add price_group column (free-text tag, stored lowercase, nullable).
ALTER TABLE products ADD COLUMN price_group TEXT;

CREATE INDEX idx_products_price_group ON products(price_group);

-- 2b. When price or carton_price changes on a grouped product,
--     push the same prices to every other product in the group.
--     Guards against self-update (id <> NEW.id) and skips NULL groups.
CREATE OR REPLACE FUNCTION sync_price_group()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price_group IS NOT NULL AND (
    NEW.price        IS DISTINCT FROM OLD.price OR
    NEW.carton_price IS DISTINCT FROM OLD.carton_price
  ) THEN
    UPDATE products
    SET
      price        = NEW.price,
      carton_price = NEW.carton_price
    WHERE price_group = NEW.price_group
      AND id          <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_product_price_group_change
  AFTER UPDATE OF price, carton_price ON products
  FOR EACH ROW EXECUTE FUNCTION sync_price_group();

COMMIT;
