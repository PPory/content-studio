CREATE TABLE intel_channels (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 url TEXT NOT NULL UNIQUE,
 site_url TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN ('rss','atom','github','manual')),
 category TEXT NOT NULL CHECK(category IN ('official','practice','questions','deep','adjacent')),
 publisher_key TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1)),
 health TEXT NOT NULL DEFAULT 'never' CHECK(health IN ('never','ok','empty','not_modified','partial','failed','manual')),
 etag TEXT NOT NULL DEFAULT '',
 last_modified TEXT NOT NULL DEFAULT '',
 last_attempt_at TEXT,
 last_success_at TEXT,
 last_error TEXT NOT NULL DEFAULT '',
 consecutive_failures INTEGER NOT NULL DEFAULT 0,
 last_item_count INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX intel_channels_enabled ON intel_channels(enabled,category);
