'use strict';
// Cần: npm i -D jsdom. Chạy: node test/e2e.js
// Nạp đúng student.html / kiosk.html / librarian.html và firebase-init.js thật, với Firebase giả
// và API thật (service.js + router.js) chạy trên Firestore giả.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');
const { FakeDb } = require('./fake-firestore');
const { createService } = require('../lib/service');
const { createHandler } = require('../lib/router');
const { STAFF, STUDENTS, BOOKS, LOCKERS } = require('../lib/seed-data');

const ROOT = path.join(__dirname, '..');
const db = new FakeDb();
[...STAFF, ...STUDENTS].forEach((u, i) => db.put('users', u.mssv, { ...u, id: i + 1, tien_no_phat: 0 }));
BOOKS.forEach((b) => db.put('books', b.id, b));
LOCKERS.forEach((l) => db.put('lockers', l.id, l));
db.put('counters', 'books', { next: BOOKS.length + 1 });
db.put('counters', 'reservations', { next: 1 });

const ACCOUNTS = {
  '251121514110@due.udn.vn': { pw: '123456', role: 'sinh_vien', tok: 'sv1' },
  'kiosk@due.udn.vn': { pw: 'Kiosk#Pass1', role: 'kiosk', tok: 'ki' },
  'thuthu@due.udn.vn': { pw: 'Lib#Pass123', role: 'thu_thu', tok: 'tt' },
};
const CLAIMS = Object.fromEntries(Object.values(ACCOUNTS).map((a) => [a.tok, { role: a.role, email: Object.keys(ACCOUNTS).find((k) => ACCOUNTS[k] === a) }]));
const handler = createHandler({ svc: createService(db), verify: async (t) => { if (!CLAIMS[t]) throw new Error('bad'); return CLAIMS[t]; } });

const apiCalls = [];
async function bridge(url, init = {}) {
  const u = typeof url === 'string' ? url : url.url;
  apiCalls.push(`${init.method || 'GET'} ${u}`);
  const headers = {};
  Object.entries(init.headers || {}).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
  const req = { method: init.method || 'GET', url: u, headers, body: init.body ? JSON.parse(init.body) : undefined };
  const out = {};
  const res = { setHeader() {}, end(s) { out.text = s; } };
  Object.defineProperty(res, 'statusCode', { set(v) { out.status = v; }, get() { return out.status; } });
  await handler(req, res);
  return { ok: out.status < 400, status: out.status, json: async () => JSON.parse(out.text) };
}
async function api(tok, method, p, body) {
  return (await bridge('/api' + p, { method, headers: { Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
}

function makeFirebase(session) {
  const listeners = [];
  const syncCbs = [];
  const mk = (u) => ({ email: u.email, getIdToken: async () => u.tok, getIdTokenResult: async () => ({ claims: { role: u.role } }) });
  const auth = {
    get currentUser() { return session.user ? mk(session.user) : null; },
    setPersistence: async () => {},
    onAuthStateChanged(cb) { listeners.push(cb); Promise.resolve().then(() => cb(auth.currentUser)); return () => listeners.splice(listeners.indexOf(cb), 1); },
    async signInWithEmailAndPassword(email, pw) {
      const a = ACCOUNTS[email];
      if (!a || a.pw !== pw) { const e = new Error('x'); e.code = 'auth/invalid-credential'; throw e; }
      session.user = { email, role: a.role, tok: a.tok };
      listeners.slice().forEach((cb) => cb(auth.currentUser));
      return {};
    },
    async signOut() { session.user = null; listeners.slice().forEach((cb) => cb(null)); },
  };
  const app = { auth: () => auth, firestore: () => ({ doc: () => ({ onSnapshot(cb) { syncCbs.push(cb); setTimeout(() => cb({}), 0); return () => {}; } }) }) };
  return {
    firebase: { initializeApp: () => app, auth: { Auth: { Persistence: { SESSION: 's', LOCAL: 'l' } }, EmailAuthProvider: { credential: () => ({}) } } },
    fireSync: () => syncCbs.forEach((cb) => cb({})),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return; } catch (e) {} await sleep(20); }
  throw new Error('Quá thời gian chờ: ' + label);
}

async function openPage(file, session) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  // Chỉ nạp firebase-init.js thật; các thư viện CDN (Tailwind, Firebase SDK, QR...) được thay bằng script rỗng.
  const resources = {
    interceptors: [requestInterceptor((request) => {
      const body = request.url.endsWith('/firebase-init.js') ? fs.readFileSync(path.join(ROOT, 'firebase-init.js'), 'utf8') : '';
      return new Response(body, { headers: { 'Content-Type': 'application/javascript' } });
    })],
  };
  const fb = makeFirebase(session);
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    url: 'http://localhost/' + file, runScripts: 'dangerously', resources, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      // jsdom chưa hỗ trợ innerText (trình duyệt thật có): ánh xạ sang textContent
      Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, set(v) { this.textContent = v; } });
      w.firebase = fb.firebase; w.fetch = bridge; w.scrollTo = () => {}; w.__alerts = []; w.alert = (m) => w.__alerts.push(m);
      w.QRCode = function (el, o) { el.dataset.qr = o.text; };
      w.Html5Qrcode = function () { this.start = () => Promise.resolve(); };
    },
  });
  await new Promise((r) => dom.window.addEventListener('load', r));
  await sleep(60);
  return { dom, w: dom.window, d: dom.window.document, errors, fb, ev: (code) => dom.window.eval(code) };
}

let pass = 0, failN = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { failN++; console.log('  LỖI ', name, '\n       ', e.message); }
}
const hidden = (el) => el.classList.contains('hidden');

(async () => {
  console.log('Trang sinh viên');
  const sess = { user: null };
  let p = await openPage('student.html', sess);
  await t('chưa đăng nhập: hiện form, không điền sẵn mật khẩu', async () => {
    assert(!hidden(p.d.getElementById('loginSection'))); assert(hidden(p.d.getElementById('mainApp')));
    eq(p.d.getElementById('loginMssv').value, ''); eq(p.d.getElementById('loginPassword').value, '');
    assert(!/123456/.test(p.d.body.textContent), 'còn dòng gợi ý mật khẩu mặc định');
  });
  await t('sai mật khẩu -> thông báo, không vào được', async () => {
    p.d.getElementById('loginMssv').value = '251121514110'; p.d.getElementById('loginPassword').value = 'sai';
    await p.ev('handleLogin({preventDefault(){}})');
    assert(!hidden(p.d.getElementById('loginError'))); assert(/Sai tài khoản/.test(p.d.getElementById('loginError').textContent));
    assert(hidden(p.d.getElementById('mainApp')));
  });
  await t('đúng mật khẩu -> vào app, tải danh mục sách qua API có token', async () => {
    p.d.getElementById('loginPassword').value = '123456';
    await p.ev('handleLogin({preventDefault(){}})');
    await until(() => !hidden(p.d.getElementById('mainApp')), 'mainApp');
    eq(p.d.getElementById('userDisplayName').textContent, 'Phạm Nhật Hạ');
    await until(() => p.ev('allBooks.length') === 13, 'allBooks');
  });
  await t('tải lại trang vẫn giữ phiên và khôi phục mã QR nhận sách', async () => {
    const r = await api('sv1', 'POST', '/reserve', { book_ids: [1, 3], ngay_hen: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), khung_gio: '08:00 - 09:30' });
    S.qr = r.primary_qr; assert(S.qr);
    p = await openPage('student.html', sess);
    await until(() => !hidden(p.d.getElementById('activeQrCard')), 'activeQrCard');
    eq(p.d.getElementById('qrTokenVal').textContent, S.qr); eq(p.d.getElementById('qrLockerNum').textContent, 'Hộc 01');
  });
  await t('nợ phạt hiển thị mới nhất khi tải trang', async () => {
    db.put('users', '251121514110', { ...db.get('users', '251121514110'), tien_no_phat: 50000 });
    p = await openPage('student.html', sess);
    await until(() => /50[.,]000/.test(p.d.getElementById('userDisplayDebt').textContent), 'debt');
  });
  await t('đăng xuất -> về form đăng nhập', async () => {
    await p.ev('handleLogout()'); await sleep(30);
    assert(!hidden(p.d.getElementById('loginSection'))); eq(sess.user, null);
  });
  await t('không có lỗi script trên trang sinh viên', async () => eq(p.errors.length, 0, p.errors.join('; ')));

  console.log('Trang kiosk');
  p = await openPage('kiosk.html', { user: null });
  await t('chưa đăng nhập: hiện form khóa, email không điền sẵn', async () => {
    assert(!hidden(p.d.getElementById('kioskLoginSection'))); eq(p.d.getElementById('kioskEmail').value, '');
  });
  await t('tài khoản sinh viên đăng nhập kiosk -> bị chặn theo role', async () => {
    const s2 = { user: null };
    const q = await openPage('kiosk.html', s2);
    q.d.getElementById('kioskEmail').value = '251121514110@due.udn.vn'; q.d.getElementById('kioskPassword').value = '123456';
    await q.ev('handleKioskLogin({preventDefault(){}})');
    await until(() => /không có quyền/.test(q.d.getElementById('kioskLoginError').textContent), 'báo thiếu quyền');
    assert(!hidden(q.d.getElementById('kioskLoginSection'))); eq(s2.user, null);
  });
  const ks = { user: null };
  p = await openPage('kiosk.html', ks);
  await t('đăng nhập kiosk -> hiện 20 hộc từ API thật', async () => {
    p.d.getElementById('kioskEmail').value = 'kiosk@due.udn.vn'; p.d.getElementById('kioskPassword').value = 'Kiosk#Pass1';
    await p.ev('handleKioskLogin({preventDefault(){}})');
    await until(() => p.d.getElementById('lockersGrid').children.length === 20, '20 hộc');
    assert(hidden(p.d.getElementById('kioskLoginSection')));
    eq(p.d.getElementById('connStatus').textContent, 'Trực tuyến');
    assert(/Chờ lấy/.test(p.d.getElementById('lockersGrid').textContent)); // hộc 01 đang có đơn của sv1
  });
  await t('mã sai KHÔNG báo mở hộc (không còn giả lập thành công)', async () => {
    p.d.getElementById('manualInput').value = 'qr-khong-co';
    await p.ev('handlePickup()');
    const box = p.d.getElementById('statusBox').textContent;
    assert(/Mã QR\/PIN không hợp lệ/.test(box), box); assert(!/🔓/.test(box));
    assert(!/ĐANG MỞ/.test(p.d.getElementById('lockersGrid').textContent));
  });
  await t('đơn chưa soạn xong -> báo lỗi thật', async () => {
    p.d.getElementById('manualInput').value = S.qr;
    await p.ev('handlePickup()');
    assert(/chuẩn bị/.test(p.d.getElementById('statusBox').textContent));
  });
  await t('đơn đã nạp -> mở hộc, hộc nhấp nháy ĐANG MỞ, ô nhập được xóa', async () => {
    await api('tt', 'POST', '/librarian/ready-group', { qr_token: S.qr });
    p.d.getElementById('manualInput').value = S.qr.toLowerCase();
    await p.ev('handlePickup()');
    await until(() => /ĐANG MỞ/.test(p.d.getElementById('lockersGrid').textContent), 'ĐANG MỞ');
    assert(/🔓/.test(p.d.getElementById('statusBox').textContent)); eq(p.d.getElementById('manualInput').value, '');
  });
  await t('tín hiệu đồng bộ -> kiosk tự tải lại hộc, không cần polling 3 giây', async () => {
    const before = apiCalls.filter((c) => c === 'GET /api/lockers').length;
    p.fb.fireSync(); await sleep(400);
    assert(apiCalls.filter((c) => c === 'GET /api/lockers').length > before);
  });
  await t('không có lỗi script trên trang kiosk', async () => eq(p.errors.length, 0, p.errors.join('; ')));

  console.log('Trang thủ thư');
  const ls = { user: null };
  p = await openPage('librarian.html', ls);
  await t('chưa đăng nhập: hiện form, email không điền sẵn', async () => {
    assert(!hidden(p.d.getElementById('librarianLoginSection'))); eq(p.d.getElementById('libEmail').value, '');
  });
  await t('tài khoản kiosk đăng nhập trang thủ thư -> bị chặn theo role', async () => {
    const q = await openPage('librarian.html', { user: null });
    q.d.getElementById('libEmail').value = 'kiosk@due.udn.vn'; q.d.getElementById('libPassword').value = 'Kiosk#Pass1';
    await q.ev('handleLibrarianLogin({preventDefault(){}})');
    await until(() => /không có quyền/.test(q.d.getElementById('libLoginError').textContent), 'báo thiếu quyền');
  });
  await t('thủ thư đăng nhập -> tải kho sách, đơn, sách trả; có tín hiệu đồng bộ thì tải lại', async () => {
    p.d.getElementById('libEmail').value = 'thuthu@due.udn.vn'; p.d.getElementById('libPassword').value = 'Lib#Pass123';
    await p.ev('handleLibrarianLogin({preventDefault(){}})');
    await until(() => p.ev('allGroupedBooks.length') === 13, 'allGroupedBooks');
    assert(hidden(p.d.getElementById('librarianLoginSection')));
    const before = apiCalls.filter((c) => c === 'GET /api/librarian/books-grouped').length;
    p.fb.fireSync(); await sleep(500);
    assert(apiCalls.filter((c) => c === 'GET /api/librarian/books-grouped').length > before);
  });
  await t('không có lỗi script trên trang thủ thư', async () => eq(p.errors.length, 0, p.errors.join('; ')));

  console.log(`\n${pass} đạt, ${failN} lỗi`);
  process.exit(failN ? 1 : 0);
})();

function eq(a, b, m) { assert.strictEqual(a, b, m); }
var S = {};
