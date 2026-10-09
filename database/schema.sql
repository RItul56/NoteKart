CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, contact_number TEXT NOT NULL, password_hash TEXT NOT NULL,
  college_name TEXT NOT NULL DEFAULT '', course_name TEXT NOT NULL DEFAULT '', branch_name TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL DEFAULT '', semester TEXT NOT NULL DEFAULT '', section TEXT NOT NULL DEFAULT '', enrollment_number TEXT NOT NULL DEFAULT '',
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS college_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS course_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS semester TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS enrollment_number TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_key TEXT;
CREATE TABLE IF NOT EXISTS admin_registration_key_uses (
  key_fingerprint TEXT PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO locations(name) VALUES ('Bhopal') ON CONFLICT(name) DO NOTHING;
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_number TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key UUID,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL, contact_number TEXT NOT NULL, college_name TEXT NOT NULL,
  course_name TEXT NOT NULL DEFAULT '', branch_name TEXT NOT NULL DEFAULT '', academic_year TEXT NOT NULL DEFAULT '', semester TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL, enrollment_number TEXT NOT NULL, delivery_address TEXT,
  work_type TEXT NOT NULL CHECK(work_type IN ('Practical','Assignment','Project Work','Other')),
  page_count INTEGER NOT NULL CHECK(page_count BETWEEN 1 AND 1000), additional_instructions TEXT NOT NULL DEFAULT '',
  quoted_amount NUMERIC(10,2), delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0, final_amount NUMERIC(10,2),
  order_status TEXT NOT NULL DEFAULT 'pending' CHECK(order_status IN ('pending','reviewing','quoted','confirmed','in_progress','ready','delivered','completed','cancelled')),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('COD','UPI','PENDING','RAZORPAY')),
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(payment_status IN ('PENDING','PAID','FAILED','REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS course_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS semester TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK(payment_method IN ('COD','UPI','PENDING','RAZORPAY'));
CREATE TABLE IF NOT EXISTS submitted_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  original_filename TEXT NOT NULL, stored_filename TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL,
  file_type TEXT NOT NULL, file_size BIGINT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL, payment_gateway TEXT, gateway_order_id TEXT, transaction_id TEXT, amount NUMERIC(10,2), currency TEXT NOT NULL DEFAULT 'INR',
  payment_status TEXT NOT NULL, gateway_response_reference TEXT, paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_order_id TEXT;
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL UNIQUE, generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency_idx ON orders(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_order_idx ON payments(gateway_order_id) WHERE gateway_order_id IS NOT NULL;
