const session = require('express-session');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { db, bucket } = require('./firebase'); // استدعاء Firebase

const app = express();
const PORT = process.env.PORT || 3000;

// بيانات الدخول (ثابتة)
const ADMIN_USERNAME = '1';
const ADMIN_PASSWORD = '1';

// إعداد EJS والملفات العامة
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// إعداد الجلسات
app.use(session({
  secret: 'lamsat_secret_key',
  resave: false,
  saveUninitialized: false
}));

// إعداد multer للتخزين في الذاكرة
const storage = multer.memoryStorage();
const upload = multer({ storage });

// صفحة تسجيل الدخول
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

// لوحة التحكم – عرض كل الأغاني من Firestore
app.get('/dashboard', async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/login');

  try {
    const snapshot = await db.collection('songs').orderBy('createdAt', 'desc').get();
    const songs = snapshot.docs.map(doc => doc.data());
    res.render('dashboard', { songs });
  } catch (err) {
    console.error("🔥 خطأ في قراءة Firestore:", err);
    res.send("Database error");
  }
});

// رفع الأغنية إلى Firebase
app.post('/upload', upload.single('song'), async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/login');
  if (!req.file) return res.status(400).send('لم يتم تحديد ملف');

  const { originalname, buffer } = req.file;
  const { title, artist, visibility } = req.body;

  const url_code = uuidv4(); // رابط خاص وفريد
  const uniqueName = Date.now() + '-' + originalname;
  const blob = bucket.file(`songs/${uniqueName}`);
  const blobStream = blob.createWriteStream();

  blobStream.on('error', err => {
    console.error("🔥 خطأ في رفع الملف:", err);
    res.status(500).send('خطأ في رفع الأغنية');
  });

  blobStream.on('finish', async () => {
    try {
      await blob.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/songs/${uniqueName}`;

      // حفظ بيانات الأغنية في Firestore
      await db.collection('songs').doc(url_code).set({
        id: url_code,
        title,
        artist,
        filename: uniqueName,
        url: publicUrl,
        url_code,
        visibility,
        createdAt: new Date()
      });

      res.redirect('/dashboard');
    } catch (err) {
      console.error("🔥 خطأ أثناء حفظ البيانات:", err);
      res.status(500).send("حدث خطأ أثناء تجهيز الرابط");
    }
  });

  blobStream.end(buffer);
});

// عرض صفحة الأغنية للعميل
app.get('/song/:code', async (req, res) => {
  try {
    const doc = await db.collection('songs').doc(req.params.code).get();
    if (!doc.exists) return res.send("لم يتم العثور على الأغنية");

    const song = doc.data();
    res.render('song', { song });
  } catch (err) {
    console.error("🔥 خطأ أثناء عرض الأغنية:", err);
    res.status(500).send("خطأ في الخادم");
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
