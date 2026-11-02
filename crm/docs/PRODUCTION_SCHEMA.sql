-- ПРОМЕТЕЙ CRM — целевая PostgreSQL схема (черновик для следующего production-спринта)
create extension if not exists pgcrypto;

create type member_role as enum ('owner','director','manager','dispatcher','accountant','driver');
create type equipment_ownership as enum ('own','rented');
create type equipment_status as enum ('available','planned','working','maintenance','repair','inactive');
create type order_status as enum ('lead','planned','confirmed','working','worked','completed','cancelled','conflict');
create type assignment_status as enum ('planned','working','completed','cancelled');

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key,
  full_name text not null,
  created_at timestamptz not null default now()
);

create table company_members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null,
  is_active boolean not null default true,
  primary key(company_id,user_id)
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  inn text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  inn text,
  phone text,
  rating numeric(3,2),
  created_at timestamptz not null default now()
);

create table objects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid references clients(id),
  manager_id uuid references profiles(id),
  name text not null,
  address text,
  lat numeric(9,6),
  lng numeric(9,6),
  status text not null default 'active',
  note text,
  created_at timestamptz not null default now()
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  partner_id uuid references partners(id),
  ownership equipment_ownership not null,
  equipment_type text not null,
  model text,
  license_plate text,
  owner_name text,
  default_driver_name text,
  sale_rate numeric(14,2) not null default 0,
  purchase_rate numeric(14,2) not null default 0,
  status equipment_status not null default 'available',
  year int,
  engine_hours numeric(12,1) not null default 0,
  created_at timestamptz not null default now(),
  unique(company_id, license_plate)
);

create table tracking_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null,
  external_id text not null,
  serial_number text,
  unique(company_id,provider,external_id)
);

create table equipment_tracking (
  company_id uuid not null references companies(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete cascade,
  tracking_device_id uuid not null references tracking_devices(id) on delete cascade,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  primary key(company_id,equipment_id,tracking_device_id,valid_from)
);

create table equipment_positions (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete cascade,
  recorded_at timestamptz not null,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  speed numeric(8,2),
  source text not null
);
create index equipment_positions_latest on equipment_positions(company_id,equipment_id,recorded_at desc);

create table orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number text not null,
  client_id uuid not null references clients(id),
  object_id uuid not null references objects(id),
  manager_id uuid not null references profiles(id),
  status order_status not null default 'planned',
  starts_at timestamptz,
  ends_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique(company_id,number)
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  equipment_id uuid references equipment(id),
  description text,
  unit text not null default 'shift',
  quantity numeric(12,2) not null default 1,
  sale_rate numeric(14,2) not null default 0,
  purchase_rate numeric(14,2) not null default 0,
  extra_expenses numeric(14,2) not null default 0,
  affects_profit boolean not null default true,
  created_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  object_id uuid not null references objects(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  equipment_id uuid not null references equipment(id),
  operator_id uuid references profiles(id),
  starts_at timestamptz,
  ends_at timestamptz,
  status assignment_status not null default 'planned',
  details text,
  created_at timestamptz not null default now()
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  assignment_id uuid not null references assignments(id) on delete cascade,
  work_date date not null,
  hours numeric(8,2) not null default 0,
  downtime numeric(8,2) not null default 0,
  overtime numeric(8,2) not null default 0,
  comment text,
  created_at timestamptz not null default now(),
  unique(company_id,assignment_id,work_date)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_id uuid references orders(id),
  client_id uuid references clients(id),
  number text not null,
  amount numeric(14,2) not null,
  status text not null default 'draft',
  issued_at date,
  due_at date,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid references invoices(id),
  order_id uuid references orders(id),
  amount numeric(14,2) not null,
  paid_at timestamptz not null,
  direction text not null check(direction in ('incoming','outgoing')),
  source text,
  external_id text,
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_id uuid references orders(id),
  equipment_id uuid references equipment(id),
  category text not null,
  amount numeric(14,2) not null,
  occurred_at date not null,
  comment text,
  created_at timestamptz not null default now()
);

create table module_entitlements (
  company_id uuid not null references companies(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default false,
  plan text,
  enabled_at timestamptz,
  primary key(company_id,module_key)
);

create table audit_log (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_company_time on audit_log(company_id,created_at desc);

-- Production: enable RLS on every tenant-scoped table and use JWT/company membership policies.
