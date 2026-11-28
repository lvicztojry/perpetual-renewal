CREATE TABLE local_document (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL CHECK (json_valid(body)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO local_document(id, body) VALUES(1, '{"format":1,"accounts":[]}');
