create index workspace_members_user_idx
  on public.workspace_members (user_id);

create index workspaces_created_by_idx
  on public.workspaces (created_by)
  where created_by is not null;

create index media_assets_owner_idx
  on public.media_assets (owner_id)
  where owner_id is not null;

create index external_document_assets_asset_idx
  on public.external_document_assets (asset_id);
