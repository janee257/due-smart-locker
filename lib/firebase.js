'use strict';
const admin = require('firebase-admin');

// Khóa dịch vụ nằm trong biến môi trường FIREBASE_SERVICE_ACCOUNT (JSON thô hoặc base64 của JSON).
function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Thiếu biến môi trường FIREBASE_SERVICE_ACCOUNT');
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return admin.credential.cert(sa);
}

let db;
function init() {
  if (!admin.apps.length) admin.initializeApp({ credential: loadCredential() });
  return admin;
}
function getDb() {
  if (!db) {
    db = init().firestore();
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}
const getAuth = () => init().auth();

module.exports = { getDb, getAuth };
