const sqlite3 = require('sqlite3').verbose();

// فتح قاعدة بيانات (تُنشئ تلقائيًا إن لم تكن موجودة)
const db = new sqlite3.Database('./songs.db');

// إنشاء الجدول إذا لم يكن موجودًا
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    artist TEXT,
    url_code TEXT NOT NULL UNIQUE,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // إضافة عمود visibility إذا لم يكن موجودًا
  db.run(`ALTER TABLE songs ADD COLUMN visibility TEXT DEFAULT 'public'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('فشل في إضافة عمود visibility:', err.message);
    }
  });
});

module.exports = db;
