'use strict';
/**
 * Khởi tạo hệ thống (chạy được nhiều lần, không ghi đè dữ liệu đã có):
 *   1. Tài khoản Firebase Auth + custom claim role cho sinh viên, thủ thư, kiosk
 *   2. Dữ liệu Firestore: users, books, lockers, counters, meta/sync
 *
 * Chạy trên máy của bạn (KHÔNG chạy trên Vercel):
 *   export FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccountKey.json)"
 *   export LIBRARIAN_PASSWORD='...'   # >= 8 ký tự, bắt buộc khi tạo tài khoản thủ thư
 *   export KIOSK_PASSWORD='...'       # >= 8 ký tự, bắt buộc khi tạo tài khoản kiosk
 *   export STUDENT_DEFAULT_PW='...'   # tùy chọn, mặc định 123456 (chỉ nên dùng khi demo)
 *   export RESET_STAFF_PASSWORDS=1    # tùy chọn: đặt lại mật khẩu thủ thư/kiosk đã có
 *   npm run seed
 */
const admin = require('firebase-admin');
const { STAFF, STUDENTS, BOOKS, LOCKERS } = require('../lib/seed-data');

function init() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    let sa;
    try { sa = JSON.parse(raw); } catch (e) { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    console.error('Thiếu FIREBASE_SERVICE_ACCOUNT (hoặc GOOGLE_APPLICATION_CREDENTIALS).');
    process.exit(1);
  }
}

async function upsertAuth(email, role, name, password, resetPassword) {
  const auth = admin.auth();
  let user;
  try {
    user = await auth.getUserByEmail(email);
    const patch = { displayName: name };
    if (resetPassword && password) patch.password = password;
    await auth.updateUser(user.uid, patch);
    console.log(`  [có sẵn]  ${email} (${role})${resetPassword && password ? ' - đã đặt lại mật khẩu' : ''}`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    if (!password) throw new Error(`Cần đặt mật khẩu cho ${email} (biến môi trường tương ứng chưa có).`);
    user = await auth.createUser({ email, password, displayName: name });
    console.log(`  [tạo mới] ${email} (${role})`);
  }
  await auth.setCustomUserClaims(user.uid, { role });
}

async function createIfMissing(ref, data) {
  const s = await ref.get();
  if (s.exists) return false;
  await ref.set(data);
  return true;
}

async function main() {
  init();
  const db = admin.firestore();
  const studentPw = process.env.STUDENT_DEFAULT_PW || '123456';
  const libPw = process.env.LIBRARIAN_PASSWORD;
  const kioskPw = process.env.KIOSK_PASSWORD;
  const reset = process.env.RESET_STAFF_PASSWORDS === '1';
  for (const [n, v] of [['LIBRARIAN_PASSWORD', libPw], ['KIOSK_PASSWORD', kioskPw]]) {
    if (v && v.length < 8) throw new Error(`${n} phải có ít nhất 8 ký tự.`);
  }
  if (!process.env.STUDENT_DEFAULT_PW) console.warn('Cảnh báo: đang dùng mật khẩu sinh viên mặc định 123456, chỉ nên dùng khi demo.');

  console.log('1) Firebase Auth');
  for (const s of STUDENTS) await upsertAuth(s.email, 'sinh_vien', s.ho_ten, studentPw, false);
  for (const s of STAFF) await upsertAuth(s.email, 'thu_thu', s.ho_ten, libPw, reset);
  await upsertAuth(process.env.KIOSK_EMAIL || 'kiosk@due.udn.vn', 'kiosk', 'Trạm Kiosk Smart Locker', kioskPw, reset);

  console.log('2) Firestore');
  let n = 0;
  [...STAFF, ...STUDENTS].forEach((u, i) => { u.id = i + 1; });
  for (const u of [...STAFF, ...STUDENTS]) n += (await createIfMissing(db.collection('users').doc(u.mssv), { ...u, tien_no_phat: 0 })) ? 1 : 0;
  console.log(`  users: thêm ${n}`);
  n = 0;
  for (const b of BOOKS) n += (await createIfMissing(db.collection('books').doc(String(b.id)), b)) ? 1 : 0;
  console.log(`  books: thêm ${n}`);
  n = 0;
  for (const l of LOCKERS) n += (await createIfMissing(db.collection('lockers').doc(String(l.id)), l)) ? 1 : 0;
  console.log(`  lockers: thêm ${n}`);
  await createIfMissing(db.doc('counters/books'), { next: BOOKS.length + 1 });
  await createIfMissing(db.doc('counters/reservations'), { next: 1 });
  await db.doc('meta/sync').set({ rev: Date.now() });
  console.log('Xong. Vai trò (role) có hiệu lực ở lần đăng nhập kế tiếp.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
