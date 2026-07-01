-- ============================================================
-- EODE POS — Supabase Database Schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'attendant');

CREATE TYPE payment_method AS ENUM ('cash', 'transfer', 'pos_card', 'credit');

CREATE TYPE delivery_status AS ENUM ('pending', 'approved', 'rejected');


-- ============================================================
-- TABLES
-- ============================================================

-- 1. Profiles — one row per Supabase Auth user
CREATE TABLE profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  full_name   TEXT        NOT NULL,
  role        user_role   NOT NULL DEFAULT 'attendant',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Products / Inventory
CREATE TABLE products (
  id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT           NOT NULL,
  price               NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  stock_quantity      NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold INTEGER        NOT NULL DEFAULT 5,
  unit_description    TEXT,          -- e.g. "750ml bottle", "per carton"
  image_url           TEXT,
  units_per_carton    INTEGER,       -- NULL = no carton option
  carton_price        NUMERIC(12, 2),
  allow_half          BOOLEAN        NOT NULL DEFAULT FALSE,
  price_group         TEXT,                    -- NULL = no group; same tag = shared price
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- 3. Sales — one row per completed transaction
CREATE TABLE sales (
  id                UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendant_id      UUID           NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  total_amount      NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  payment_method_1  payment_method NOT NULL,
  amount_1          NUMERIC(12, 2) NOT NULL CHECK (amount_1 >= 0),
  payment_method_2  payment_method,           -- NULL when only one payment method
  amount_2          NUMERIC(12, 2) CHECK (amount_2 IS NULL OR amount_2 >= 0),
  receipt_number    BIGSERIAL,                -- auto-incrementing for receipt display
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- 4. Sale items — line items belonging to a sale
CREATE TABLE sale_items (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id         UUID           NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id      UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity        NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  sell_type       TEXT           NOT NULL DEFAULT 'unit',  -- 'unit' | 'carton'
  units_deducted  NUMERIC(10, 2) NOT NULL                  -- qty for unit sales, qty*upc for carton
);

-- 5. Deliveries — stock-in logging with admin approval flow
CREATE TABLE deliveries (
  id                UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  logged_by         UUID             NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  product_id        UUID             NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_received INTEGER          NOT NULL CHECK (quantity_received > 0),
  note              TEXT,
  status            delivery_status  NOT NULL DEFAULT 'pending',
  rejection_reason  TEXT,
  approved_by       UUID             REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- 6. Store settings — single-row table (id is always 1)
CREATE TABLE store_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name  TEXT    NOT NULL DEFAULT 'EODE POS',
  short_name     TEXT,
  tagline        TEXT,
  address        TEXT,
  city           TEXT,
  state          TEXT,
  phone          TEXT,
  logo_url       TEXT
);

-- Seed the single settings row so UPDATE always finds a row
INSERT INTO store_settings (id) VALUES (1) ON CONFLICT DO NOTHING;


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_sales_attendant_id    ON sales(attendant_id);
CREATE INDEX idx_sales_created_at      ON sales(created_at DESC);
CREATE INDEX idx_sale_items_sale_id    ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product_id ON sale_items(product_id);
CREATE INDEX idx_deliveries_product_id ON deliveries(product_id);
CREATE INDEX idx_deliveries_logged_by  ON deliveries(logged_by);
CREATE INDEX idx_deliveries_status     ON deliveries(status);
CREATE INDEX idx_products_name         ON products(name);
CREATE INDEX idx_products_price_group  ON products(price_group);


-- ============================================================
-- HELPER FUNCTION
-- Uses SECURITY DEFINER so it bypasses RLS when called from
-- within other policies (avoids infinite recursion on profiles).
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- TRIGGERS
-- ============================================================

-- T1: Auto-create a profile row when a new Supabase Auth user is created.
--     full_name and role can be passed as raw_user_meta_data at sign-up time.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'attendant')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- T2: Decrement product stock when a sale item is recorded.
--     Uses units_deducted (not quantity) so carton sales deduct the correct
--     number of individual units, and half-unit sales deduct 0.5 correctly.
--     stock_quantity is NUMERIC(10,2) so fractional deductions are stored exactly.
CREATE OR REPLACE FUNCTION decrement_stock_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity - NEW.units_deducted
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_sale_item_inserted
  AFTER INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION decrement_stock_on_sale();


-- T3: Increment product stock only when a delivery transitions to 'approved'.
--     Guards against double-counting if the row is updated again later.
CREATE OR REPLACE FUNCTION increment_stock_on_delivery_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    UPDATE products
    SET stock_quantity = stock_quantity + NEW.quantity_received
    WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_delivery_approved
  AFTER UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION increment_stock_on_delivery_approval();


-- T4: Restore product stock when a sale_item is deleted (cascade from sale delete).
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


-- T5: When price or carton_price changes on a product in a group,
--     push the same prices to all other products in that group.
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


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

-- profiles -------------------------------------------------------
-- Own row read; admins read all; admins manage all
CREATE POLICY "profiles: own read"
  ON profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles: admin read all"
  ON profiles FOR SELECT USING (is_admin());

CREATE POLICY "profiles: admin insert"
  ON profiles FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "profiles: admin update"
  ON profiles FOR UPDATE USING (is_admin());

CREATE POLICY "profiles: admin delete"
  ON profiles FOR DELETE USING (is_admin());

-- products -------------------------------------------------------
-- Any authenticated user can read; only admins can write
CREATE POLICY "products: authenticated read"
  ON products FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "products: admin insert"
  ON products FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "products: admin update"
  ON products FOR UPDATE USING (is_admin());

CREATE POLICY "products: admin delete"
  ON products FOR DELETE USING (is_admin());

-- sales ----------------------------------------------------------
-- Attendants insert/read own; admins read all and delete
CREATE POLICY "sales: attendant insert own"
  ON sales FOR INSERT WITH CHECK (attendant_id = auth.uid());

CREATE POLICY "sales: attendant read own"
  ON sales FOR SELECT USING (attendant_id = auth.uid());

CREATE POLICY "sales: admin read all"
  ON sales FOR SELECT USING (is_admin());

CREATE POLICY "sales: admin delete"
  ON sales FOR DELETE USING (is_admin());

-- sale_items -----------------------------------------------------
-- Attendant can insert items for sales they own;
-- anyone who can see the parent sale can see its items
CREATE POLICY "sale_items: attendant insert"
  ON sale_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM sales WHERE id = sale_id AND attendant_id = auth.uid())
  );

CREATE POLICY "sale_items: read via parent sale"
  ON sale_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sales
      WHERE id = sale_id
        AND (attendant_id = auth.uid() OR is_admin())
    )
  );

-- deliveries -----------------------------------------------------
-- Attendants log and read own; admins read all and update status
CREATE POLICY "deliveries: attendant insert"
  ON deliveries FOR INSERT WITH CHECK (logged_by = auth.uid());

CREATE POLICY "deliveries: attendant read own"
  ON deliveries FOR SELECT USING (logged_by = auth.uid());

CREATE POLICY "deliveries: admin read all"
  ON deliveries FOR SELECT USING (is_admin());

CREATE POLICY "deliveries: admin update status"
  ON deliveries FOR UPDATE USING (is_admin());

-- store_settings -------------------------------------------------
-- Any authenticated user can read; only admins can update
CREATE POLICY "store_settings: authenticated read"
  ON store_settings FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "store_settings: admin update"
  ON store_settings FOR UPDATE USING (is_admin());
