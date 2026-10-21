-- Bnder Notice : هيكل قاعدة البيانات (شغّله مرة واحدة من D1 > Console)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  mosque TEXT, zone TEXT, floor TEXT, gate TEXT, spot TEXT,
  lat REAL, lng REAL, acc REAL,
  category TEXT, category_label TEXT, entity_id TEXT,
  priority TEXT DEFAULT 'normal',
  details TEXT,
  reporter_name TEXT, reporter_phone TEXT,
  has_photo INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  referred_at INTEGER, closed_at INTEGER, closure_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS photos (
  report_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  action TEXT, note TEXT, actor TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_report ON events(report_id);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO entities (id, name, sort) VALUES
 ('security',    'الجهات الأمنية', 1),
 ('crowd',       'إدارة الحشود', 2),
 ('cleaning',    'النظافة والتعقيم', 3),
 ('maintenance', 'الصيانة والتشغيل', 4),
 ('hvac',        'التكييف والتبريد', 5),
 ('safety',      'السلامة والدفاع المدني', 6),
 ('medical',     'الخدمات الإسعافية', 7),
 ('zamzam',      'سقيا زمزم', 8),
 ('sound',       'الصوتيات', 9),
 ('visitors',    'خدمات القاصدين', 10);
