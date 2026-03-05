CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
  document_id UNINDEXED,
  title,
  content
);
