-- Supabase foundation for the productized workbench.
-- Business records remain in D1 during the staged migration; this migration
-- establishes the tenant boundary and the private media source of truth.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  bucket_id text not null default 'workbench-media' check (bucket_id = 'workbench-media'),
  storage_path text not null check (storage_path <> ''),
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (
    mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp')
  ),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('workbench', 'feishu', 'vault-migration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, storage_path)
);

create index media_assets_workspace_created_idx
  on public.media_assets (workspace_id, created_at desc, id desc);

create index media_assets_workspace_sha256_idx
  on public.media_assets (workspace_id, sha256);

create table public.external_document_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  provider text not null check (provider = 'feishu'),
  entity_type text not null check (entity_type in ('draft')),
  entity_id text not null check (entity_id <> ''),
  external_document_id text not null check (external_document_id <> ''),
  external_token text not null check (external_token <> ''),
  block_id text,
  ordinal integer not null check (ordinal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_document_id, external_token),
  unique (provider, external_document_id, ordinal)
);

create index external_document_assets_entity_idx
  on public.external_document_assets (workspace_id, entity_type, entity_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.media_assets enable row level security;
alter table public.external_document_assets enable row level security;

-- Phase one is server-only. There are deliberately no anon/authenticated
-- policies: the local Node service uses the Supabase secret key, while future
-- browser access will receive explicit membership-based RLS policies together
-- with Supabase Auth.
revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.media_assets from anon, authenticated;
revoke all on table public.external_document_assets from anon, authenticated;

insert into public.workspaces (id, slug, name)
values ('00000000-0000-0000-0000-000000000001', 'personal', '辛禾工作台')
on conflict (slug) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workbench-media',
  'workbench-media',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
