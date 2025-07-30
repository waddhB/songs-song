const session = require('express-session');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // 🔄 لبث ملفات الصوت الخاصة
const { db, bucket } = require('./firebase');

const app = express();
const PORT = process.env.PORT || 3000;

// بيانات الدخول
const ADMIN_USERNAME = '1';
const ADMIN_PASSWORD = '1';

// إعدادات EJS والملفات العامة
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// جلسات تسجيل الدخول
app.use(session({
  secret: 'lamsat_secret_key',
  resave: false,
  saveUninitialized: false
}));

// إعداد رفع الملفات
const storage = multer.memoryStorage();
const upload = multer({ storage });

// الصفحة الرئيسية → تسجيل الدخول
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
});

// عرض لوحة التحكم
app.get('/dashboard', async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/login');

  try {
    const snapshot = await db.collection('songs').orderBy('createdAt', 'desc').get();
    const songs = snapshot.docs.map(doc => doc.data());
    res.render('dashboard', { songs, req }); // ✅ تمرير req لبناء روابط المشاركة
  } catch (err) {
    console.error("🔥 خطأ في قراءة Firestore:", err);
    res.send("Database error");
  }
});

// رفع أغنية
app.post('/upload', upload.single('song'), async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/login');
  if (!req.file) return res.status(400).send('لم يتم تحديد ملف');

  const { originalname, buffer } = req.file;
  const { title, artist, visibility } = req.body;

  const url_code = uuidv4();
  const uniqueName = Date.now() + '-' + originalname;
  const blob = bucket.file(`songs/${uniqueName}`);
  const blobStream = blob.createWriteStream({
    metadata: {
      contentType: req.file.mimetype
    }
  });

  blobStream.on('error', err => {
    console.error("🔥 خطأ في رفع الملف:", err);
    res.status(500).send('خطأ في رفع الأغنية');
  });

  blobStream.on('finish', async () => {
    try {
      const [url] = await blob.getSignedUrl({
        action: 'read',
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000
      });

      await db.collection('songs').doc(url_code).set({
        id: url_code,
        title,
        artist,
        filename: uniqueName,
        url,
        url_code,
        visibility,
        createdAt: new Date()
      });

      res.redirect('/dashboard');
    } catch (err) {
      console.error("🔥 خطأ أثناء تجهيز الرابط:", err);
      res.status(500).send("حدث خطأ أثناء تجهيز الرابط");
    }
  });

  blobStream.end(buffer);
});

// صفحة عرض الأغنية
app.get('/song/:code', async (req, res) => {
  try {
    const doc = await db.collection('songs').doc(req.params.code).get();
    if (!doc.exists) return res.send("❌ لم يتم العثور على الأغنية");

    const song = doc.data();
    res.render('song', { song });
  } catch (err) {
    console.error("🔥 خطأ أثناء عرض الأغنية:", err);
    res.status(500).send("خطأ في الخادم");
  }
});

// 🔒 بث الأغنية الخاصة فقط (بدون كشف رابط الصوت)
app.get('/stream/:code', async (req, res) => {
  try {
    const doc = await db.collection('songs').doc(req.params.code).get();
    if (!doc.exists) return res.status(404).send("❌ الأغنية غير موجودة");

    const song = doc.data();

    if (song.visibility !== 'private') {
      return res.redirect(song.url); // الأغاني العامة يُعاد توجيهها مباشرة
    }

    const response = await fetch(song.url);
    if (!response.ok) throw new Error("❌ فشل في تحميل الملف من Firebase");

    res.setHeader('Content-Type', 'audio/mpeg');
    response.body.pipe(res);
  } catch (err) {
    console.error("🔥 فشل في بث الصوت:", err);
    res.status(500).send("خطأ أثناء تشغيل الصوت");
  }
});

// حذف أغنية
app.post('/delete/:id', async (req, res) => {
  const songId = req.params.id;

  try {
    const docRef = db.collection('songs').doc(songId);
    const doc = await docRef.get();

    if (!doc.exists) return res.redirect('/dashboard');

    const song = doc.data();
    const file = bucket.file(`songs/${song.filename}`);

    await file.delete();
    await docRef.delete();

    res.redirect('/dashboard');
  } catch (err) {
    console.error("🔥 فشل الحذف:", err);
    res.redirect('/dashboard');
  }
});

// تسجيل الخروج
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// تشغيل السيرفر
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
