-- Supabase becomes canonical after the verified cutover. Until then these
-- tables receive read-only shadow imports from D1; Feishu is a synchronized
-- editable projection, never the only copy of business data.

create table public.inbox (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, title text not null,
  kind text not null default '想法' check (kind in ('文章链接','视频链接','想法','摘录')),
  link text not null default '', source text not null default '', body text not null default '', card_markdown text not null default '',
  status text not null default '待初筛' check (status in ('待初筛','待选题','已选题','存档备用','已弃用','初筛失败/需人工')),
  value_judgment text not null default '' check (value_judgment in ('','值得深挖','存档备用','建议弃用')),
  verdict text not null default '', capture_origin text not null default 'idea' check (capture_origin in ('collection','idea')),
  processing_mode text not null default 'triage' check (processing_mode in ('hold','triage')),
  review_status text not null default 'kept' check (review_status in ('pending','kept','archived')),
  save_note text not null default '', selection text not null default '', canonical_url text not null default '', content_hash text not null default '',
  snapshot_status text not null default 'not_needed' check (snapshot_status in ('pending','ready','failed','not_needed')),
  snapshot_error text not null default '', snapshot_at bigint, vault_path text,
  created_at bigint not null, updated_at bigint not null, deleted_at timestamptz,
  primary key (workspace_id, id)
);
create index inbox_status_idx on public.inbox (workspace_id, status, created_at);
create index inbox_collection_review_idx on public.inbox (workspace_id, capture_origin, review_status, updated_at);
create index inbox_canonical_url_idx on public.inbox (workspace_id, canonical_url) where canonical_url <> '';
create index inbox_content_hash_idx on public.inbox (workspace_id, content_hash) where content_hash <> '';

create table public.topics (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, title text not null, viewpoint text not null default '', audience text not null default '', notes text not null default '',
  platform text not null default '' check (platform in ('','公众号','X','小红书','视频号','YouTube')),
  priority text not null default '中' check (priority in ('高','中','低')),
  status text not null default '待写' check (status in ('待写','撰写中','已成稿','已发布','搁置')),
  primary_draft_id text, draft_note text not null default '', vault_path text, task_key text,
  created_at bigint not null, updated_at bigint not null, deleted_at timestamptz,
  primary key (workspace_id, id), unique (workspace_id, task_key)
);
create index topics_status_idx on public.topics (workspace_id, status, created_at);

create table public.drafts (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, topic_id text, headline text not null, summary text not null default '', body text not null default '',
  platform text not null check (platform in ('公众号','X','小红书','视频号','YouTube')),
  status text not null default '待修改' check (status in ('待修改','已发布')),
  workflow_status text not null default '写作中' check (workflow_status in ('写作中','待诊断','待发布','已发布','已弃用')),
  parent_draft_id text, published_url text not null default '', published_at text not null default '',
  views bigint, likes bigint, comments bigint, collects bigint, shares bigint,
  performance_summary text not null default '',
  feedback_status text not null default '未评估' check (feedback_status in ('未评估','样本不足','普通','表现突出','已沉淀')),
  review_conclusion text not null default '', next_experiment text not null default '', reviewed_at text not null default '',
  cover_url text not null default '', cover_text text not null default '', cover_note text not null default '',
  keywords_json text not null default '[]', interaction_goal text not null default '', vault_path text,
  task_key text not null, created_at bigint not null, updated_at bigint not null, deleted_at timestamptz,
  primary key (workspace_id, id), unique (workspace_id, task_key),
  foreign key (workspace_id, topic_id) references public.topics(workspace_id, id) on delete cascade deferrable initially deferred,
  foreign key (workspace_id, parent_draft_id) references public.drafts(workspace_id, id) on delete set null deferrable initially deferred
);
create index drafts_topic_idx on public.drafts (workspace_id, topic_id);
create index drafts_status_idx on public.drafts (workspace_id, status, created_at);
create index drafts_workflow_idx on public.drafts (workspace_id, workflow_status, updated_at);
create index drafts_parent_idx on public.drafts (workspace_id, parent_draft_id);

create table public.materials (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, title text not null, content text not null default '',
  type text not null default '核心观点' check (type in ('核心观点','金句/原话','数据/事实','案例/故事','框架/模型','反直觉点','个人经历','延展问题','标题样本','内容角度','平台反馈')),
  source_url text not null default '', inbox_id text,
  verification text not null default '不适用' check (verification in ('不适用','待核验','已核验')),
  verification_note text not null default '', draft_id text, feedback_types text not null default '', performance_basis text not null default '',
  vault_path text, task_key text, created_at bigint not null, updated_at bigint not null, deleted_at timestamptz,
  primary key (workspace_id, id), unique (workspace_id, task_key),
  foreign key (workspace_id, inbox_id) references public.inbox(workspace_id, id) on delete set null,
  foreign key (workspace_id, draft_id) references public.drafts(workspace_id, id) on delete set null
);
create index materials_inbox_idx on public.materials (workspace_id, inbox_id);
create index materials_draft_idx on public.materials (workspace_id, draft_id);
create index materials_type_idx on public.materials (workspace_id, type, created_at);

create table public.tags (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id bigint generated by default as identity, name text not null,
  primary key (workspace_id, id), unique (workspace_id, name)
);

-- D1 legacy rows keep their numeric tag ids. The shadow importer calls this
-- after every tag upsert so the next Supabase-generated id cannot collide.
create or replace function public.reset_content_studio_tag_sequence()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_id bigint;
begin
  select coalesce(max(id), 0) + 1 into next_id from public.tags;
  perform setval(pg_get_serial_sequence('public.tags', 'id')::regclass, next_id, false);
  return next_id;
end;
$$;
revoke all on function public.reset_content_studio_tag_sequence() from public, anon, authenticated;
grant execute on function public.reset_content_studio_tag_sequence() to service_role;
create table public.material_tags (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001', material_id text not null, tag_id bigint not null,
  primary key (workspace_id, material_id, tag_id),
  foreign key (workspace_id, material_id) references public.materials(workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id) references public.tags(workspace_id, id) on delete cascade
);
create index material_tags_tag_idx on public.material_tags (workspace_id, tag_id);
create table public.inbox_tags (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001', inbox_id text not null, tag_id bigint not null,
  primary key (workspace_id, inbox_id, tag_id),
  foreign key (workspace_id, inbox_id) references public.inbox(workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id) references public.tags(workspace_id, id) on delete cascade
);
create index inbox_tags_tag_idx on public.inbox_tags (workspace_id, tag_id);
create table public.topic_materials (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001', topic_id text not null, material_id text not null,
  primary key (workspace_id, topic_id, material_id),
  foreign key (workspace_id, topic_id) references public.topics(workspace_id, id) on delete cascade,
  foreign key (workspace_id, material_id) references public.materials(workspace_id, id) on delete cascade
);
create index topic_materials_material_idx on public.topic_materials (workspace_id, material_id);
create table public.topic_inbox (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001', topic_id text not null, inbox_id text not null,
  primary key (workspace_id, topic_id, inbox_id),
  foreign key (workspace_id, topic_id) references public.topics(workspace_id, id) on delete cascade,
  foreign key (workspace_id, inbox_id) references public.inbox(workspace_id, id) on delete cascade
);
create index topic_inbox_inbox_idx on public.topic_inbox (workspace_id, inbox_id);

create table public.comments (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, entity text not null check (entity in ('inbox','materials','topics','drafts')), entity_id text not null, text text not null, created_at bigint not null,
  primary key (workspace_id, id)
);
create index comments_entity_idx on public.comments (workspace_id, entity, entity_id, created_at);
create table public.task_log (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  task_key text not null, kind text not null, entity_id text, done_at bigint not null, primary key (workspace_id, task_key)
);
create table public.settings (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  key text not null, value text not null, updated_at bigint not null, primary key (workspace_id, key)
);
create table public.agent_tasks (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, idempotency_key text not null, kind text not null, scope_id text not null default '', document_id text not null default '', document_version text not null default '',
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  attempt integer not null default 0, max_attempts integer not null default 3, lease_owner text not null default '', lease_expires_at bigint not null default 0,
  heartbeat_at bigint not null default 0, harness_session_id text not null default '', pi_session_id text not null default '', stage text not null default 'queued',
  stage_label text not null default '', percent integer not null default 0 check (percent between 0 and 100), payload_json text not null default '{}',
  result_json text not null default '', error text not null default '', created_at bigint not null, updated_at bigint not null, finished_at bigint not null default 0,
  primary key (workspace_id, id), unique (workspace_id, idempotency_key)
);
create index agent_tasks_scope_updated_idx on public.agent_tasks (workspace_id, scope_id, updated_at desc);
create index agent_tasks_lease_idx on public.agent_tasks (workspace_id, status, lease_expires_at);

create table public.external_documents (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, provider text not null check (provider = 'feishu'),
  entity_type text not null check (entity_type in ('draft','inbox','material','topic','seed','insight','knowledge','plan','webnote','review','monthly_review')),
  entity_id text not null, external_id text not null, external_url text not null default '', container_id text not null default '',
  content_hash text not null default '', remote_hash text not null default '', last_source text not null default 'local' check (last_source in ('local','remote')),
  last_synced_at bigint not null, remote_missing_at timestamptz, created_at bigint not null, updated_at bigint not null,
  primary key (workspace_id, id), unique (workspace_id, provider, entity_type, entity_id), unique (provider, external_id)
);
create index external_documents_entity_idx on public.external_documents (workspace_id, entity_type, entity_id);
create table public.seeds (
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id) on delete cascade,
  id text not null, reaction text not null default '', take text not null,
  source_kind text not null default 'none' check (source_kind in ('none','hot','inbox','material')),
  source_id text not null default '', source_title text not null default '', source_url text not null default '', source_excerpt text not null default '',
  source_fetched_at bigint not null default 0, status text not null default '攒着' check (status in ('攒着','写了','不写了')), draft_id text,
  created_at bigint not null, updated_at bigint not null, deleted_at timestamptz,
  primary key (workspace_id, id), foreign key (workspace_id, draft_id) references public.drafts(workspace_id, id) on delete set null
);
create index seeds_status_idx on public.seeds (workspace_id, status, updated_at);
create index seeds_draft_idx on public.seeds (workspace_id, draft_id);

-- Application-owned long-form documents. Rows must be created by a workbench
-- business endpoint with a stable source key; vault files are never an import source.
create table public.content_documents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('insight','knowledge','plan','webnote','review','monthly_review')),
  source_key text not null check (source_key <> ''), title text not null check (char_length(title) between 1 and 800), body text not null default '',
  source_path text, metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'), content_hash text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (workspace_id, kind, source_key)
);
create index content_documents_kind_updated_idx on public.content_documents (workspace_id, kind, updated_at desc);

create table public.published_posts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_key text not null check (source_key <> ''), draft_id text, published_on date, platform text not null default '', title text not null default '', url text not null default '',
  views bigint, likes bigint, comments bigint, collects bigint, shares bigint,
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'), synced boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (workspace_id, source_key),
  foreign key (workspace_id, draft_id) references public.drafts(workspace_id, id) on delete set null
);
create index published_posts_platform_date_idx on public.published_posts (workspace_id, platform, published_on desc);
create index published_posts_draft_idx on public.published_posts (workspace_id, draft_id);

create table public.feishu_tree_nodes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  node_key text not null check (node_key <> ''), node_token text not null check (node_token <> ''), obj_token text not null default '',
  obj_type text not null default 'docx', parent_node_token text not null default '', title text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, node_key), unique (node_token)
);
create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider = 'feishu'), entity_type text not null, entity_id text not null,
  local_hash text not null default '', remote_hash text not null default '', base_local_hash text not null default '', base_remote_hash text not null default '',
  status text not null default 'open' check (status in ('open','resolved_local','resolved_remote','resolved_merged','dismissed')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'), created_at timestamptz not null default now(), resolved_at timestamptz
);
create index sync_conflicts_open_idx on public.sync_conflicts (workspace_id, status, created_at desc);

alter table public.external_document_assets drop constraint if exists external_document_assets_entity_type_check;
alter table public.external_document_assets add constraint external_document_assets_entity_type_check
  check (entity_type in ('draft','insight','knowledge','plan','webnote','review','monthly_review'));

-- Public is an exposed schema on existing Supabase projects. These tables are
-- backend-only during migration, so grants and RLS are both explicit.
do $$
declare table_name text;
begin
  foreach table_name in array array['inbox','topics','drafts','materials','tags','material_tags','inbox_tags','topic_materials','topic_inbox','comments','task_log','settings','agent_tasks','external_documents','seeds','content_documents','published_posts','feishu_tree_nodes','sync_conflicts'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end
$$;
grant usage, select on all sequences in schema public to service_role;
