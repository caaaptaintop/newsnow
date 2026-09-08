import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { intelligenceBackfillV2, intelligenceReadV2, intelligenceSaveV2, intelligenceSchemaV2 } from '../server/database/intelligence-v2.ts'
import { intelligenceMetadataOnly, intelligenceStoragePolicy } from '../shared/intelligence-storage.ts'

function fixture(overrides = {}) {
  return {
    key: 'building:test', topic: 'building', title: '测试通知', url: 'https://example.invalid/notice',
    sourceId: 'test-source', sourceName: '测试机构', sourceGroup: '住建官方', sourceLevel: '省级',
    region: '江苏', city: '', column: '通知公告', publisher: '测试发布单位',
    publishedAt: 1700000000000, collectedAt: 1700000100000, documentNo: '测试〔2026〕1号',
    attachments: [{ title: '通知附件.pdf', url: 'https://example.invalid/attachment.pdf' }],
    category: 'intelligent_construction', relatedCategories: ['smart_building'], tags: ['BIM'],
    contentType: '通知公告', importance: 75, summary: '测试摘要', reason: '测试依据',
    evidence: 'body', model: 'test-model', analysisVersion: 'test-v1',
    otherSources: [{ name: '另一来源', url: 'https://example.invalid/repost' }], ...overrides,
  }
}
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const sql of intelligenceSchemaV2) db.exec(sql)
  return db
}
function save(db, article) {
  const safe = intelligenceMetadataOnly(article)
  db.prepare(intelligenceSaveV2).run(safe.key, safe.topic, safe.publishedAt ?? null, safe.collectedAt, JSON.stringify(safe))
}
function read(db) {
  return db.prepare(intelligenceReadV2).all('building', 'building').map(row => JSON.parse(row.data))
}
function count(db, table) { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n }

test('schema is additive and idempotent', () => {
  const db = database()
  save(db, fixture())
  for (const sql of intelligenceSchemaV2) db.exec(sql)
  assert.equal(count(db, 'intelligence_documents_v1'), 1)
  assert.equal(count(db, 'intelligence_documents_v2'), 1)
  db.close()
})

test('structured records round-trip without changing the feed contract', () => {
  const db = database()
  const article = fixture()
  save(db, article)
  assert.deepEqual(read(db), [article])
  assert.equal(count(db, 'intelligence_sources_v2'), 1)
  assert.equal(count(db, 'intelligence_document_categories_v2'), 2)
  assert.equal(count(db, 'intelligence_document_tags_v2'), 1)
  db.close()
})

test('storage policy is metadata only and immutable', () => {
  assert.deepEqual(intelligenceStoragePolicy, {
    schemaVersion: 2, saveBody: false, saveHtml: false, downloadAttachments: false,
    r2Enabled: false, attachmentMode: 'links_only',
  })
  assert.ok(Object.isFrozen(intelligenceStoragePolicy))
})

test('allowlist discards body, HTML, attachment bytes and unknown nested fields', () => {
  const db = database()
  const article = fixture({
    body: 'DO_NOT_PERSIST', rawHtml: '<html>DO_NOT_PERSIST</html>', fullText: 'DO_NOT_PERSIST',
    attachments: [{ title: '附件', url: 'https://example.invalid/file', bytes: 'DO_NOT_PERSIST', objectKey: 'DO_NOT_PERSIST' }],
    otherSources: [{ name: '机构', url: 'https://example.invalid/other', content: 'DO_NOT_PERSIST' }],
  })
  save(db, article)
  const payload = db.prepare('SELECT data FROM intelligence_documents_v1').get().data
  assert.ok(!payload.includes('DO_NOT_PERSIST'))
  assert.ok(!JSON.stringify(read(db)).includes('DO_NOT_PERSIST'))
  db.close()
})

test('body evidence does not imply persisted content; attachments are remote links', () => {
  const db = database()
  save(db, fixture())
  const contents = db.prepare('SELECT * FROM intelligence_content_refs_v2').all()
  assert.equal(contents.length, 2)
  for (const row of contents) {
    assert.equal(row.storage_status, 'not_saved')
    assert.equal(row.storage_provider, null)
    assert.equal(row.object_key, null)
    assert.equal(row.byte_size, null)
  }
  const attachment = db.prepare('SELECT * FROM intelligence_attachments_v2').get()
  assert.equal(attachment.storage_status, 'remote')
  assert.equal(attachment.storage_provider, null)
  assert.equal(attachment.object_key, null)
  assert.equal(attachment.byte_size, null)
  db.close()
})

test('missing publication date is never replaced by collection date', () => {
  const db = database()
  save(db, fixture({ publishedAt: undefined }))
  assert.equal(db.prepare('SELECT published_at FROM intelligence_documents_v2').get().published_at, null)
  assert.equal(intelligenceMetadataOnly(read(db)[0]).publishedAt, undefined)
  db.close()
})

test('repeat saves update current categories and tags without duplicate rows', () => {
  const db = database()
  save(db, fixture())
  const second = fixture({ category: 'smart_building', relatedCategories: [], tags: ['数字孪生', '数字孪生'], attachments: [], collectedAt: 1700000200000 })
  save(db, second)
  save(db, second)
  assert.equal(count(db, 'intelligence_documents_v2'), 1)
  assert.equal(count(db, 'intelligence_analyses_v2'), 1)
  assert.equal(count(db, 'intelligence_document_categories_v2'), 1)
  assert.equal(count(db, 'intelligence_document_tags_v2'), 1)
  assert.equal(count(db, 'intelligence_attachments_v2'), 0)
  assert.equal(db.prepare('SELECT first_collected_at FROM intelligence_documents_v2').get().first_collected_at, fixture().collectedAt)
  assert.equal(read(db)[0].category, second.category)
  db.close()
})

test('AI results are separate and retained across model/version changes', () => {
  const db = database()
  save(db, fixture())
  save(db, fixture({ model: 'new-model', analysisVersion: 'test-v2', summary: '新版摘要' }))
  assert.equal(count(db, 'intelligence_analyses_v2'), 2)
  assert.equal(read(db)[0].summary, '新版摘要')
  assert.equal(read(db)[0].model, 'new-model')
  db.close()
})

test('legacy rows stay visible through bounded, resumable migration', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(intelligenceSchemaV2[0])
  const insert = db.prepare('INSERT INTO intelligence_documents_v1 VALUES (?, ?, ?, ?, ?)')
  for (let i = 0; i < 61; i++) {
    const a = fixture({ key: `building:legacy-${i}` })
    insert.run(a.key, a.topic, a.publishedAt, a.collectedAt, JSON.stringify(a))
  }
  for (const sql of intelligenceSchemaV2) db.exec(sql)
  assert.equal(read(db).length, 61)
  db.exec(intelligenceBackfillV2)
  assert.equal(count(db, 'intelligence_documents_v2'), 50)
  assert.equal(read(db).length, 61)
  db.exec(intelligenceBackfillV2)
  assert.equal(count(db, 'intelligence_documents_v2'), 61)
  db.exec(intelligenceBackfillV2)
  assert.equal(count(db, 'intelligence_documents_v1'), 61)
  assert.equal(read(db).length, 61)
  db.close()
})

test('invalid legacy JSON is not deleted or passed to the migration triggers', () => {
  const db = database()
  db.prepare('INSERT INTO intelligence_documents_v1 VALUES (?, ?, ?, ?, ?)').run('bad', 'building', null, 1, '{invalid')
  save(db, fixture())
  db.exec(intelligenceBackfillV2)
  assert.equal(count(db, 'intelligence_documents_v1'), 2)
  assert.equal(count(db, 'intelligence_documents_v2'), 1)
  db.close()
})

test('constraint failure rolls back the entire projection and compatibility write', () => {
  const db = database()
  assert.throws(() => save(db, fixture({ importance: 101 })))
  for (const table of ['intelligence_documents_v1', 'intelligence_documents_v2', 'intelligence_sources_v2', 'intelligence_analyses_v2']) {
    assert.equal(count(db, table), 0)
  }
  save(db, fixture())
  assert.throws(() => save(db, fixture({ importance: -1, title: '不应保存' })))
  assert.equal(read(db)[0].title, fixture().title)
  db.close()
})

test('deleting a record clears projections without orphan records', () => {
  const db = database()
  save(db, fixture())
  db.prepare('DELETE FROM intelligence_documents_v1 WHERE id=?').run(fixture().key)
  for (const table of ['intelligence_documents_v2', 'intelligence_analyses_v2', 'intelligence_document_categories_v2',
    'intelligence_document_tags_v2', 'intelligence_attachments_v2', 'intelligence_content_refs_v2']) {
    assert.equal(count(db, table), 0)
  }
  db.close()
})

test('reserved archive references survive metadata updates without file operations', () => {
  const db = database()
  save(db, fixture())
  // A future provider reference is simulated in SQL only. No files are fetched.
  db.exec("UPDATE intelligence_content_refs_v2 SET storage_status='stored', storage_provider='future-test', object_key='test-key' WHERE representation='text'")
  save(db, fixture({ title: '更新标题' }))
  assert.equal(db.prepare("SELECT object_key FROM intelligence_content_refs_v2 WHERE representation='text'").get().object_key, 'test-key')
  assert.throws(() => db.exec("UPDATE intelligence_attachments_v2 SET storage_status='stored'"))
  db.close()
})
