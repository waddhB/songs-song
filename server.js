const session = require('express-session');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { PassThrough } = require('stream');
const { db, bucket } = require('./firebase');
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = '1';
const ADMIN_PASSWORD = '1';
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'lamsat_secret_key',
  resave: false,
  saveUninitialized: false
}));
const storage = multer.memoryStorage();
const upload = multer({ storage });
app.get('/', (req, res) => res.redirect('/login'));
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
app.get('/dashboard', async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/login');
  try {
    const snapshot = await db.collection('songs').orderBy('createdAt', 'desc').get();
    const songs = snapshot.docs.map(doc => doc.data());
    res.render('dashboard', { songs, req });
  } catch (err) {
    console.error("🔥 Firestore Error:", err);
    res.send("Database error");
  }
});
app.post('/upload', upload.single('song'), async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/login');
  if (!req.file) return res.status(400).send('لم يتم تحديد ملف');
  const { originalname, buffer } = req.file;
  const { title, artist, visibility } = req.body;
  const url_code = uuidv4();
  const uniqueName = Date.now() + '-' + originalname;
  const blob = bucket.file(`songs/${uniqueName}`);
  const blobStream = blob.createWriteStream({
    metadata: { contentType: req.file.mimetype }
  });
  blobStream.on('error', err => {
    console.error("🔥 Upload Error:", err);
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
      console.error("🔥 Signed URL Error:", err);
      res.status(500).send("حدث خطأ أثناء تجهيز الرابط");
    }
  });
  blobStream.end(buffer);
});
app.get('/song/:code', async (req, res) => {
  try {
    const doc = await db.collection('songs').doc(req.params.code).get();
    if (!doc.exists) return res.send("❌ لم يتم العثور على الأغنية");
    const song = doc.data();
    res.render('song', { song });
  } catch (err) {
    console.error("🔥 Song Page Error:", err);
    res.status(500).send("خطأ في الخادم");
  }
});
// ✅ بث مجزأ للأغاني الخاصة فقط + أقصى حماية
app.get('/stream/:code', async (req, res) => {
  try {
    const doc = await db.collection('songs').doc(req.params.code).get();
    if (!doc.exists) return res.status(404).send("❌ الأغنية غير موجودة");
    const song = doc.data();
    if (song.visibility !== 'private') {
      return res.redirect(song.url); // العامة توجه مباشرة
    }
    const file = bucket.file(`songs/${song.filename}`);
    const [metadata] = await file.getMetadata();
    const fileSize = Number(metadata.size);
    const range = req.headers.range;
    if (!range) {
      return res.status(416).send('❌ يتطلب دعم Range Requests');
    }
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;
    const stream = file.createReadStream({ start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline; filename="audio.bin"'
    });
    stream.pipe(res);
  } catch (err) {
    console.error("🔥 Stream Error:", err);
    res.status(500).send("خطأ أثناء البث");
  }
});
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
    console.error("🔥 Delete Error:", err);
    res.redirect('/dashboard');
  }
});
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
