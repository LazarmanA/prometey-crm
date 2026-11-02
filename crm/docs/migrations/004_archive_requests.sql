-- Reference migration for the draft PostgreSQL schema. Not used by the JSON prototype.
-- Existing rows stay nullable; the API requires these values on create/edit.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES profiles(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS equipment_type text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS request_at timestamp;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS requested_ownership text CHECK (requested_ownership IN ('own','rented','mixed'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS equipment_type text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requested_ownership text CHECK (requested_ownership IN ('own','rented','mixed'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE objects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS starts_on date;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS ends_on date;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS billable_quantity numeric(12,2) CHECK (billable_quantity >= 0);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS unit text CHECK (unit IN ('shift','hour','unit'));
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS sale_rate numeric(14,2) CHECK (sale_rate >= 0);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS purchase_rate numeric(14,2) CHECK (purchase_rate >= 0);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS extra_expenses numeric(14,2) CHECK (extra_expenses >= 0);
CREATE INDEX IF NOT EXISTS clients_company_archived ON clients(company_id,archived_at);
CREATE INDEX IF NOT EXISTS orders_company_archived ON orders(company_id,archived_at);
-- Moscow local datetime input must be converted with AT TIME ZONE 'Europe/Moscow'
-- when written to the draft orders.starts_at / ends_at timestamptz columns.
