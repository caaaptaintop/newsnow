/** Metadata-only v2. No network, object storage, or file-content columns. */
export const intelligenceSchemaVersion = 2

const value = (key: string) => `json_extract(NEW.data, '$.${key}')`
const text = (key: string) => `COALESCE(${value(key)}, '')`
const array = (key: string) => `COALESCE(${value(key)}, '[]')`

// Both INSERT and UPDATE use the same trigger body. The trigger and its
// originating write are one SQLite statement: partial relational writes roll back.
const projectArticle = `
  INSERT INTO intelligence_sources_v2 (id, name, source_group, source_level, region, city)
  VALUES (${text("sourceId")}, ${text("sourceName")}, ${text("sourceGroup")}, ${text("sourceLevel")}, ${text("region")}, ${text("city")})
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, source_group=excluded.source_group,
    source_level=excluded.source_level, region=excluded.region, city=excluded.city;

  INSERT INTO intelligence_documents_v2
    (id, topic, title, url, source_id, source_column, publisher, document_no,
     published_at, first_collected_at, last_collected_at, current_model, current_analysis_version, other_sources)
  VALUES (NEW.id, NEW.topic, ${text("title")}, ${text("url")}, ${text("sourceId")}, ${text("column")},
    ${value("publisher")}, ${value("documentNo")}, NEW.published, NEW.collected, NEW.collected,
    ${text("model")}, ${text("analysisVersion")}, ${array("otherSources")})
  ON CONFLICT(id) DO UPDATE SET topic=excluded.topic, title=excluded.title, url=excluded.url,
    source_id=excluded.source_id, source_column=excluded.source_column, publisher=excluded.publisher,
    document_no=excluded.document_no, published_at=excluded.published_at,
    first_collected_at=MIN(intelligence_documents_v2.first_collected_at, excluded.first_collected_at),
    last_collected_at=excluded.last_collected_at, current_model=excluded.current_model,
    current_analysis_version=excluded.current_analysis_version, other_sources=excluded.other_sources;

  INSERT INTO intelligence_analyses_v2
    (document_id, model, analysis_version, category, related_categories, tags, content_type,
     importance, summary, reason, evidence, collected_at)
  VALUES (NEW.id, ${text("model")}, ${text("analysisVersion")}, ${text("category")},
    ${array("relatedCategories")}, ${array("tags")}, ${text("contentType")},
    COALESCE(${value("importance")}, 0), ${text("summary")}, ${value("reason")},
    CASE WHEN ${value("evidence")}='body' THEN 'body' ELSE 'title' END, NEW.collected)
  ON CONFLICT(document_id, model, analysis_version) DO UPDATE SET
    category=excluded.category, related_categories=excluded.related_categories, tags=excluded.tags,
    content_type=excluded.content_type, importance=excluded.importance, summary=excluded.summary,
    reason=excluded.reason, evidence=excluded.evidence, collected_at=excluded.collected_at;

  DELETE FROM intelligence_document_categories_v2 WHERE document_id=NEW.id;
  INSERT INTO intelligence_document_categories_v2 (document_id, category, role)
    VALUES (NEW.id, ${text("category")}, 'primary');
  INSERT INTO intelligence_document_categories_v2 (document_id, category, role)
    SELECT NEW.id, value, 'related' FROM json_each(${array("relatedCategories")}) WHERE type='text'
    ON CONFLICT(document_id, category) DO NOTHING;
  DELETE FROM intelligence_document_tags_v2 WHERE document_id=NEW.id;
  INSERT INTO intelligence_document_tags_v2 (document_id, tag)
    SELECT NEW.id, value FROM json_each(${array("tags")}) WHERE type='text'
    ON CONFLICT(document_id, tag) DO NOTHING;

  DELETE FROM intelligence_attachments_v2
    WHERE document_id=NEW.id AND storage_status='remote'
      AND url NOT IN (SELECT json_extract(value, '$.url') FROM json_each(${array("attachments")}));
  INSERT INTO intelligence_attachments_v2 (document_id, url, title)
    SELECT NEW.id, json_extract(value, '$.url'), COALESCE(json_extract(value, '$.title'), '')
    FROM json_each(${array("attachments")}) WHERE json_extract(value, '$.url') IS NOT NULL
    ON CONFLICT(document_id, url) DO UPDATE SET title=excluded.title;

  INSERT INTO intelligence_content_refs_v2 (document_id, representation)
    VALUES (NEW.id, 'text'), (NEW.id, 'html')
    ON CONFLICT(document_id, representation) DO NOTHING;
`

export const intelligenceSchemaV2 = [
  `CREATE TABLE IF NOT EXISTS intelligence_documents_v1 (
    id TEXT PRIMARY KEY, topic TEXT NOT NULL, published INTEGER, collected INTEGER NOT NULL, data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS intelligence_documents_topic_v1 ON intelligence_documents_v1 (topic, published)`,
  `CREATE TABLE IF NOT EXISTS intelligence_state_v1 (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS intelligence_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS intelligence_sources_v2 (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, source_group TEXT NOT NULL, source_level TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS intelligence_documents_v2 (
    id TEXT PRIMARY KEY, topic TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES intelligence_sources_v2(id), source_column TEXT NOT NULL DEFAULT '',
    publisher TEXT, document_no TEXT, published_at INTEGER,
    first_collected_at INTEGER NOT NULL, last_collected_at INTEGER NOT NULL,
    current_model TEXT NOT NULL, current_analysis_version TEXT NOT NULL,
    other_sources TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(other_sources))
  )`,
  `CREATE INDEX IF NOT EXISTS intelligence_documents_topic_date_v2
    ON intelligence_documents_v2(topic, published_at DESC, last_collected_at DESC)`,
  `CREATE INDEX IF NOT EXISTS intelligence_documents_source_v2 ON intelligence_documents_v2(source_id, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS intelligence_sources_location_v2 ON intelligence_sources_v2(region, city)`,
  `CREATE TABLE IF NOT EXISTS intelligence_analyses_v2 (
    document_id TEXT NOT NULL REFERENCES intelligence_documents_v2(id) ON DELETE CASCADE,
    model TEXT NOT NULL, analysis_version TEXT NOT NULL, category TEXT NOT NULL,
    related_categories TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(related_categories)),
    tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)), content_type TEXT NOT NULL,
    importance INTEGER NOT NULL CHECK(importance BETWEEN 0 AND 100), summary TEXT NOT NULL,
    reason TEXT, evidence TEXT NOT NULL CHECK(evidence IN ('body','title')), collected_at INTEGER NOT NULL,
    PRIMARY KEY(document_id, model, analysis_version)
  )`,
  `CREATE INDEX IF NOT EXISTS intelligence_analyses_type_importance_v2 ON intelligence_analyses_v2(content_type, importance)`,
  `CREATE TABLE IF NOT EXISTS intelligence_document_categories_v2 (
    document_id TEXT NOT NULL REFERENCES intelligence_documents_v2(id) ON DELETE CASCADE,
    category TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('primary','related')),
    PRIMARY KEY(document_id, category)
  )`,
  `CREATE INDEX IF NOT EXISTS intelligence_categories_lookup_v2 ON intelligence_document_categories_v2(category, document_id)`,
  `CREATE TABLE IF NOT EXISTS intelligence_document_tags_v2 (
    document_id TEXT NOT NULL REFERENCES intelligence_documents_v2(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY(document_id, tag)
  )`,
  `CREATE INDEX IF NOT EXISTS intelligence_tags_lookup_v2 ON intelligence_document_tags_v2(tag, document_id)`,
  `CREATE TABLE IF NOT EXISTS intelligence_attachments_v2 (
    document_id TEXT NOT NULL REFERENCES intelligence_documents_v2(id) ON DELETE CASCADE,
    url TEXT NOT NULL, title TEXT NOT NULL,
    storage_status TEXT NOT NULL DEFAULT 'remote' CHECK(storage_status IN ('remote','stored','error')),
    storage_provider TEXT, object_key TEXT, content_hash TEXT, byte_size INTEGER CHECK(byte_size >= 0), archived_at INTEGER,
    PRIMARY KEY(document_id, url),
    CHECK(storage_status != 'stored' OR (storage_provider IS NOT NULL AND object_key IS NOT NULL))
  )`,
  `CREATE TABLE IF NOT EXISTS intelligence_content_refs_v2 (
    document_id TEXT NOT NULL REFERENCES intelligence_documents_v2(id) ON DELETE CASCADE,
    representation TEXT NOT NULL CHECK(representation IN ('text','html')),
    storage_status TEXT NOT NULL DEFAULT 'not_saved' CHECK(storage_status IN ('not_saved','stored','error')),
    storage_provider TEXT, object_key TEXT, content_hash TEXT, byte_size INTEGER CHECK(byte_size >= 0), archived_at INTEGER,
    PRIMARY KEY(document_id, representation),
    CHECK(storage_status != 'stored' OR (storage_provider IS NOT NULL AND object_key IS NOT NULL))
  )`,
  `CREATE TRIGGER IF NOT EXISTS intelligence_project_insert_v2 AFTER INSERT ON intelligence_documents_v1
    WHEN json_valid(NEW.data) BEGIN ${projectArticle} END`,
  `CREATE TRIGGER IF NOT EXISTS intelligence_project_update_v2 AFTER UPDATE ON intelligence_documents_v1
    WHEN json_valid(NEW.data) BEGIN ${projectArticle} END`,
  `CREATE TRIGGER IF NOT EXISTS intelligence_project_delete_v2 AFTER DELETE ON intelligence_documents_v1 BEGIN
    DELETE FROM intelligence_document_categories_v2 WHERE document_id=OLD.id;
    DELETE FROM intelligence_document_tags_v2 WHERE document_id=OLD.id;
    DELETE FROM intelligence_attachments_v2 WHERE document_id=OLD.id;
    DELETE FROM intelligence_content_refs_v2 WHERE document_id=OLD.id;
    DELETE FROM intelligence_analyses_v2 WHERE document_id=OLD.id;
    DELETE FROM intelligence_documents_v2 WHERE id=OLD.id;
  END`,
  `CREATE VIEW IF NOT EXISTS intelligence_feed_v2 AS
    SELECT d.id, d.topic, d.published_at AS published, d.last_collected_at AS collected,
      json_object(
        'key', d.id, 'topic', d.topic, 'title', d.title, 'url', d.url,
        'sourceId', s.id, 'sourceName', s.name, 'sourceGroup', s.source_group, 'sourceLevel', s.source_level,
        'region', s.region, 'city', s.city, 'column', d.source_column, 'publisher', d.publisher,
        'publishedAt', d.published_at, 'collectedAt', d.last_collected_at, 'documentNo', d.document_no,
        'attachments', json(COALESCE((SELECT json_group_array(json_object('title', f.title, 'url', f.url))
          FROM intelligence_attachments_v2 f WHERE f.document_id=d.id), '[]')),
        'category', a.category, 'relatedCategories', json(a.related_categories), 'tags', json(a.tags),
        'contentType', a.content_type, 'importance', a.importance, 'summary', a.summary, 'reason', a.reason,
        'evidence', a.evidence, 'model', a.model, 'analysisVersion', a.analysis_version,
        'otherSources', json(d.other_sources)
      ) AS data
    FROM intelligence_documents_v2 d
    JOIN intelligence_sources_v2 s ON s.id=d.source_id
    JOIN intelligence_analyses_v2 a ON a.document_id=d.id
      AND a.model=d.current_model AND a.analysis_version=d.current_analysis_version`,
]

// Bounded and resumable: no full-table migration in one serverless request.
// Corrupt legacy JSON is left untouched and excluded from the projection.
export const intelligenceBackfillV2 = `UPDATE intelligence_documents_v1 SET data=data
  WHERE id IN (SELECT old.id FROM intelligence_documents_v1 old
    WHERE json_valid(old.data)
      AND NOT EXISTS (SELECT 1 FROM intelligence_documents_v2 d WHERE d.id=old.id)
    ORDER BY old.id LIMIT 50)`

export const intelligenceSaveV2 = `INSERT INTO intelligence_documents_v1 (id, topic, published, collected, data)
  VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    topic=excluded.topic, published=excluded.published, collected=excluded.collected, data=excluded.data`

// Legacy rows remain visible until each bounded backfill has migrated them.
export const intelligenceReadV2 = `SELECT data FROM (
  SELECT id, topic, published, collected, data FROM intelligence_feed_v2 WHERE topic=?
  UNION ALL
  SELECT old.id, old.topic, old.published, old.collected, old.data FROM intelligence_documents_v1 old
    WHERE old.topic=? AND NOT EXISTS (SELECT 1 FROM intelligence_documents_v2 d WHERE d.id=old.id)
) ORDER BY COALESCE(published, 0) DESC, collected DESC LIMIT 5001`
