const admin = require('firebase-admin');

// تحميل مفتاح الخدمة من Firebase Console
const serviceAccount = require('./firebase-service-key.json');

// تهيئة Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "wadd-f0a19.firebasestorage.app" // ← ✅ التصحيح المهم هنا
});

// الوصول إلى Firestore و Storage
const db = admin.firestore();                 // ← قاعدة البيانات Firestore
const bucket = admin.storage().bucket();      // ← تخزين الملفات Firebase Storage

module.exports = { db, bucket };
