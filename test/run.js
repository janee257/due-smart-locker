'use strict';
const assert = require('assert');
const { FakeDb } = require('./fake-firestore');
const { createService } = require('../lib/service');
const { createHandler } = require('../lib/router');
const { STAFF, STUDENTS, BOOKS, LOCKERS } = require('../lib/seed-data');

// ---------- dựng dữ liệu ----------
const db = new FakeDb();
[...STAFF, ...STUDENTS].forEach((u, i) => db.put('users', u.mssv, { ...u, id: i + 1, tien_no_phat: 0 }));
BOOKS.forEach((b) => db.put('books', b.id, b));
LOCKERS.forEach((l) => db.put('lockers', l.id, l));
db.put('counters', 'books', { next: BOOKS.length + 1 });
db.put('counters', 'reservations', { next: 1 });
db.put('meta', 'sync', { rev: 0 });

const TOKENS = {
  sv1: { role: 'sinh_vien', email: '251121514110@due.udn.vn' }, // id 2
  sv2: { role: 'sinh_vien', email: '241121521143@due.udn.vn' }, // id 3
  sv3: { role: 'sinh_vien', email: '241121521153@due.udn.vn' }, // id 4
  tt: { role: 'thu_thu', email: 'thuthu@due.udn.vn' },
  ki: { role: 'kiosk', email: 'kiosk@due.udn.vn' },
  ghost: { role: 'sinh_vien', email: '999@due.udn.vn' },
  norole: { email: 'x@due.udn.vn' },
};
const handler = createHandler({
  svc: createService(db),
  verify: async (t) => { if (!TOKENS[t]) throw new Error('bad'); return TOKENS[t]; },
});

async function call(method, path, tok, body) {
  const req = { method, url: '/api' + path, headers: tok ? { authorization: 'Bearer ' + tok } : {}, body };
  const out = {};
  const res = { setHeader() {}, end(s) { out.json = s ? JSON.parse(s) : null; } };
  Object.defineProperty(res, 'statusCode', { set(v) { out.status = v; }, get() { return out.status; } });
  await handler(req, res);
  return out;
}
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + 7 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const order = (ids, extra = {}) => ({ book_ids: ids, ngay_hen: today(), khung_gio: '08:00 - 09:30', ...extra });

// ---------- khung test ----------
let pass = 0, failN = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { failN++; console.log('  LỖI ', name, '\n       ', e.message); }
}
const eq = assert.strictEqual;
const S = {}; // trạng thái dùng chung giữa các bước

(async () => {
  console.log('Xác thực và phân quyền');
  await t('không token -> 401', async () => eq((await call('GET', '/books')).status, 401));
  await t('token rác -> 401', async () => eq((await call('GET', '/books', 'zzz')).status, 401));
  await t('không có role -> 403', async () => eq((await call('GET', '/books', 'norole')).status, 403));
  await t('MSSV không có trong danh sách -> 403', async () => eq((await call('GET', '/me', 'ghost')).status, 403));
  await t('sinh viên gọi API thủ thư -> 403', async () => eq((await call('GET', '/librarian/orders', 'sv1')).status, 403));
  await t('sinh viên mở hộc kiosk -> 403', async () => eq((await call('POST', '/locker/pickup', 'sv1', { qr_token: 'QR-X' })).status, 403));
  await t('kiosk gọi API thủ thư -> 403', async () => eq((await call('GET', '/librarian/orders', 'ki')).status, 403));
  await t('thủ thư xem lịch sử sinh viên -> 403', async () => eq((await call('GET', '/student/history/2', 'tt')).status, 403));
  await t('xem lịch sử người khác -> 403', async () => eq((await call('GET', '/student/history/3', 'sv1')).status, 403));
  await t('xem lịch sử của mình -> 200', async () => eq((await call('GET', '/student/history/2', 'sv1')).status, 200));
  await t('login/change-password cũ -> 410', async () => eq((await call('POST', '/student/login', null, {})).status, 410));
  await t('đường dẫn lạ -> 404, sai phương thức -> 405', async () => {
    eq((await call('GET', '/khong-co', 'tt')).status, 404);
    eq((await call('DELETE', '/books', 'tt')).status, 405);
  });
  await t('/api/me', async () => {
    const r = await call('GET', '/me', 'sv1');
    eq(r.json.id, 2); eq(r.json.mssv, '251121514110');
    eq((await call('GET', '/me', 'tt')).json.role, 'thu_thu');
  });

  console.log('Đặt mượn và cấp hộc');
  await t('danh mục sách gom theo tên', async () => {
    const r = await call('GET', '/books', 'sv1');
    eq(r.json.length, 13);
    const g = r.json.find((b) => b.ten_sach.startsWith('Quản lý Quy trình'));
    eq(g.tong_so_luong, 2); eq(g.so_luong_con, 2); eq(g.id, 1);
    S.qtcsdl = r.json.find((b) => b.ten_sach === 'Quản trị Cơ sở Dữ liệu').id;
  });
  await t('sv1 đặt 2 cuốn -> 1 hộc, 1 mã QR', async () => {
    const r = await call('POST', '/reserve', 'sv1', order([1, S.qtcsdl], { user_id: 999 })); // user_id giả bị bỏ qua
    eq(r.status, 200); eq(r.json.all_lockers, 'Hộc 01'); assert(r.json.primary_qr.startsWith('QR-'));
    S.qr1 = r.json.primary_qr;
    assert(db.all('reservations').every((x) => x.user_id === 2));
    eq(db.all('books').filter((b) => b.trang_thai === 'da_dat_giu').length, 2);
    eq(db.get('lockers', 1).trang_thai, 'cho_nhan');
  });
  await t('hết hàng -> 400, không ghi gì', async () => {
    const before = JSON.stringify(db.all('reservations'));
    const r = await call('POST', '/reserve', 'sv2', order([1, 1]));
    eq(r.status, 400); assert(/hết hàng/.test(r.json.detail));
    eq(JSON.stringify(db.all('reservations')), before);
  });
  await t('sv2 đặt cuốn còn lại -> Hộc 02', async () => {
    const r = await call('POST', '/reserve', 'sv2', order([1]));
    eq(r.status, 200); eq(r.json.all_lockers, 'Hộc 02');
  });
  await t('ngày hẹn quá khứ / sai định dạng -> 400', async () => {
    eq((await call('POST', '/reserve', 'sv3', order([5], { ngay_hen: '2020-01-01' }))).status, 400);
    eq((await call('POST', '/reserve', 'sv3', order([5], { ngay_hen: 'abc' }))).status, 400);
  });
  await t('giới hạn 2 đơn chờ nhận mỗi sinh viên', async () => {
    eq((await call('POST', '/reserve', 'sv1', order([5]))).status, 200);
    const r = await call('POST', '/reserve', 'sv1', order([6]));
    eq(r.status, 400); assert(/đơn chờ nhận/.test(r.json.detail));
  });
  await t('đặt cùng lúc nhiều đơn không trùng hộc', async () => {
    const rs = await Promise.all([call('POST', '/reserve', 'sv3', order([8])), call('POST', '/reserve', 'sv2', order([9]))]);
    rs.forEach((r) => eq(r.status, 200));
    const lockers = db.all('reservations').filter((r) => r.trang_thai_don === 'cho_soan').map((r) => r.locker_id);
    eq(new Set(db.all('lockers').filter((l) => l.trang_thai === 'cho_nhan').map((l) => l.id)).size, 5);
    assert(lockers.length >= 5);
  });
  await t('/student/pending trả lại mã QR để hiển thị sau khi tải lại trang', async () => {
    const r = await call('GET', '/student/pending', 'sv1');
    eq(r.status, 200); eq(r.json.pickup.length, 2); assert(r.json.pickup.some((p) => p.qr_token === S.qr1 && p.count === 2 && p.so_hoc === 'Hộc 01' && !p.san_sang));
  });

  console.log('Thủ thư soạn sách, kiosk phát sách');
  await t('thủ thư thấy đơn gom theo mã QR', async () => {
    const r = await call('GET', '/librarian/orders', 'tt');
    const g = r.json.find((o) => o.qr_token === S.qr1);
    eq(g.books.length, 2); eq(g.mssv, '251121514110'); eq(g.so_hoc, 'Hộc 01');
  });
  await t('kiosk quét khi chưa nạp sách -> 400', async () => {
    const r = await call('POST', '/locker/pickup', 'ki', { qr_token: S.qr1 });
    eq(r.status, 400); assert(/chuẩn bị/.test(r.json.detail));
  });
  await t('mã QR sai -> 404', async () => eq((await call('POST', '/locker/pickup', 'ki', { qr_token: 'QR-SAI' })).status, 404));
  await t('thủ thư nạp hộc -> kiosk mở hộc, mượn 14 ngày', async () => {
    eq((await call('POST', '/librarian/ready-group', 'tt', { qr_token: S.qr1 })).status, 200);
    const r = await call('POST', '/locker/pickup', 'ki', { qr_token: S.qr1.toLowerCase() }); // chữ thường vẫn nhận
    eq(r.status, 200); eq(r.json.opened_locker, 'Hộc 01');
    const rs = db.all('reservations').filter((x) => x.qr_token === S.qr1);
    assert(rs.every((x) => x.trang_thai_don === 'dang_muon' && x.han_tra === plusDays(14) && x.ngay_muon === today()));
    eq(db.get('lockers', 1).trang_thai, 'trong');
  });
  await t('quét lại cùng mã -> 400 (chỉ nhận một lần)', async () => {
    const r = await call('POST', '/locker/pickup', 'ki', { qr_token: S.qr1 });
    eq(r.status, 400); assert(/đã được nhận/.test(r.json.detail));
  });
  await t('sách đang mượn của sv1', async () => {
    const r = await call('GET', '/student/borrowed/2', 'sv1');
    eq(r.json.length, 2); S.resIds = r.json.map((x) => x.res_id);
  });
  await t('thu hồi đơn quá hạn: trả sách về kho, mở hộc', async () => {
    const o = (await call('GET', '/librarian/orders', 'tt')).json.find((x) => x.mssv === '241121521143');
    eq((await call('POST', '/librarian/cancel-expired-group', 'tt', { qr_token: o.qr_token })).status, 200);
    eq(db.all('reservations').filter((r) => r.qr_token === o.qr_token).every((r) => r.trang_thai_don === 'da_huy_do_qua_han'), true);
    eq((await call('POST', '/librarian/cancel-expired-group', 'tt', { qr_token: S.qr1 })).status, 404); // không thu hồi được đơn đã mượn
    eq(db.all('books').filter((b) => b.trang_thai === 'dang_muon').length, 2);
  });

  console.log('Trả sách và giữ hộc');
  await t('tạo QR trả -> giữ hộc, người khác không bị cấp trùng', async () => {
    const r = await call('POST', '/student/create-return-qr', 'sv1', { reservation_ids: S.resIds });
    eq(r.status, 200); assert(r.json.qr_token.startsWith('TRA-')); eq(r.json.count, 2);
    S.tra1 = r.json.qr_token; S.traLocker = r.json.so_hoc;
    const lk = db.all('lockers').find((l) => l.so_hoc === S.traLocker);
    eq(lk.trang_thai, 'cho_tra'); eq(lk.token, S.tra1);
    const o = await call('POST', '/reserve', 'sv3', order([10]));
    eq(o.status, 200); assert(o.json.all_lockers !== S.traLocker, 'hộc đang giữ để trả bị cấp cho đơn khác');
  });
  await t('kiosk công khai trạng thái hộc nhưng không lộ token', async () => {
    const r = await call('GET', '/lockers', 'ki');
    eq(r.json.length, 20); assert(r.json.every((l) => !('token' in l) && !('hold_until' in l)));
    eq(r.json.find((l) => l.so_hoc === S.traLocker).trang_thai, 'cho_tra');
  });
  await t('sinh viên khác không tạo được QR trả cho sách của người khác', async () => {
    eq((await call('POST', '/student/create-return-qr', 'sv2', { reservation_ids: S.resIds })).status, 400);
  });
  await t('tạo lại QR -> mã cũ hết hiệu lực, hộc cũ được nhả', async () => {
    const r = await call('POST', '/student/create-return-qr', 'sv1', { reservation_ids: S.resIds });
    eq(r.status, 200); S.tra2 = r.json.qr_token; assert(S.tra2 !== S.tra1);
    eq((await call('POST', '/locker/pickup', 'ki', { qr_token: S.tra1 })).status, 404);
    eq(db.all('lockers').filter((l) => l.trang_thai === 'cho_tra').length, 1);
  });
  await t('/student/pending có mã QR trả', async () => {
    const r = await call('GET', '/student/pending', 'sv1');
    eq(r.json.return.qr_token, S.tra2); eq(r.json.return.count, 2);
  });
  await t('hộc giữ quá hạn: hiện là trống; bị cấp cho đơn khác thì mã trả cũ hết hiệu lực', async () => {
    const lk = db.all('lockers').find((l) => l.trang_thai === 'cho_tra');
    db.put('lockers', lk.id, { ...lk, hold_until: Date.now() - 1000 });
    eq((await call('GET', '/lockers', 'ki')).json.find((l) => l.id === lk.id).trang_thai, 'trong');
    // làm bận mọi hộc có số nhỏ hơn để đơn mới chắc chắn rơi vào hộc vừa hết hạn
    const lower = db.all('lockers').filter((l) => l.id < lk.id && l.trang_thai === 'trong');
    lower.forEach((l) => db.put('lockers', l.id, { ...l, trang_thai: 'cho_nhan' }));
    const o = await call('POST', '/reserve', 'sv2', order([11]));
    eq(o.status, 200); eq(o.json.all_lockers, lk.so_hoc);
    lower.forEach((l) => db.put('lockers', l.id, l)); // trả lại như cũ
    const r = await call('POST', '/locker/pickup', 'ki', { qr_token: S.tra2 });
    eq(r.status, 400); assert(/hết hạn|người khác/.test(r.json.detail));
  });
  await t('tạo QR mới sau khi hết hạn, kiosk nhận sách, tính phạt trễ hạn', async () => {
    const rows = db.all('reservations').filter((r) => S.resIds.includes(r.id));
    db.put('reservations', rows[0].id, { ...rows[0], han_tra: plusDays(-3) }); // quá hạn 3 ngày
    const r = await call('POST', '/student/create-return-qr', 'sv1', { reservation_ids: S.resIds });
    eq(r.status, 200); S.tra3 = r.json.qr_token;
    const o = await call('POST', '/locker/pickup', 'ki', { qr_token: S.tra3 });
    eq(o.status, 200); assert(/Vui lòng bỏ toàn bộ 2 cuốn/.test(o.json.message));
    const rs = db.all('reservations').filter((x) => S.resIds.includes(x.id));
    assert(rs.every((x) => x.trang_thai_don === 'cho_kiem_tra' && x.ngay_tra === today()));
    eq(rs.find((x) => x.id === rows[0].id).tien_phat, 15000);
    eq(db.all('lockers').find((l) => l.trang_thai === 'chua_sach_tra').so_hoc, r.json.so_hoc);
    eq((await call('POST', '/locker/pickup', 'ki', { qr_token: S.tra3 })).status, 404); // không quét lại được
  });

  console.log('Kiểm tra sách trả');
  await t('danh sách chờ kiểm tra + sách mượn có cờ trễ hạn', async () => {
    const r = await call('GET', '/librarian/returns-inspect', 'tt');
    eq(r.json.length, 2); assert(r.json.some((x) => x.tien_phat === 15000));
    eq((await call('GET', '/librarian/active-borrows', 'tt')).json.length, 2);
  });
  await t('phạt âm / tình trạng lạ bị từ chối', async () => {
    eq((await call('POST', '/librarian/inspect-book', 'tt', { reservation_id: S.resIds[0], tinh_trang: 'hu_hong', tien_phat_them: -50000 })).status, 400);
    eq((await call('POST', '/librarian/inspect-book', 'tt', { reservation_id: S.resIds[0], tinh_trang: 'khac' })).status, 400);
    eq(db.get('users', '251121514110').tien_no_phat, 0);
  });
  await t('sách nguyên vẹn: về kho; hộc còn sách chưa kiểm thì chưa trống', async () => {
    const a = (await call('GET', '/librarian/returns-inspect', 'tt')).json[0];
    const r = await call('POST', '/librarian/inspect-book', 'tt', { reservation_id: a.id, tinh_trang: 'binh_thuong' });
    eq(r.status, 200); eq(db.all('lockers').filter((l) => l.trang_thai === 'chua_sach_tra').length, 1);
    eq((await call('POST', '/librarian/inspect-book', 'tt', { reservation_id: a.id, tinh_trang: 'binh_thuong' })).status, 400); // không kiểm tra lại
  });
  await t('sách hư hỏng: cộng nợ, hộc được giải phóng, chặn mượn tiếp', async () => {
    const b = (await call('GET', '/librarian/returns-inspect', 'tt')).json[0];
    const r = await call('POST', '/librarian/inspect-book', 'tt', { reservation_id: b.id, tinh_trang: 'hu_hong', tien_phat_them: 50000 });
    eq(r.status, 200);
    eq(db.get('users', '251121514110').tien_no_phat, 50000);
    eq(db.all('lockers').filter((l) => l.trang_thai === 'chua_sach_tra').length, 0);
    const m = await call('POST', '/reserve', 'sv1', order([7]));
    eq(m.status, 400); assert(/nợ phạt/.test(m.json.detail));
    eq((await call('GET', '/me', 'sv1')).json.tien_no_phat, 50000);
  });

  console.log('Trả bằng mã vạch và gom sách');
  await t('mượn rồi trả bằng mã vạch tại kiosk', async () => {
    const o = (await call('GET', '/librarian/orders', 'tt')).json.find((x) => x.mssv === '241121521153');
    await call('POST', '/librarian/ready-group', 'tt', { qr_token: o.qr_token });
    eq((await call('POST', '/locker/pickup', 'ki', { qr_token: o.qr_token })).status, 200);
    const code = o.books[0].ma_vach;
    const r = await call('POST', '/locker/return', 'ki', { ma_vach: code.toLowerCase() });
    eq(r.status, 200); assert(r.json.opened_locker);
    eq((await call('POST', '/locker/return', 'ki', { ma_vach: code })).status, 404);
  });
  await t('gom sách trả cuối ca', async () => {
    eq((await call('POST', '/librarian/collect-all', 'tt')).status, 200);
    eq(db.all('books').filter((b) => b.trang_thai === 'cho_kiem_tra').length, 0);
    eq(db.all('lockers').filter((l) => l.trang_thai === 'chua_sach_tra').length, 0);
  });

  console.log('Quản lý kho');
  await t('thêm sách: trùng mã vạch bị chặn, nhiều bản có hậu tố', async () => {
    eq((await call('POST', '/books', 'tt', { ma_vach: 'DUE-MIS-001', ten_sach: 'X', tac_gia: 'a', vi_tri_ke: 'b' })).status, 400);
    eq((await call('POST', '/books', 'tt', { ma_vach: 'abc', ten_sach: 'Sách Mới', tac_gia: 'T', vi_tri_ke: 'K1', so_luong: 3 })).status, 200);
    const codes = db.all('books').filter((b) => b.ten_sach === 'Sách Mới').map((b) => b.ma_vach).sort();
    eq(codes.join(), 'ABC-01,ABC-02,ABC-03');
    eq(new Set(db.all('books').map((b) => b.id)).size, db.all('books').length); // id không trùng
  });
  await t('tăng / giảm / đặt số lượng', async () => {
    const n = () => db.all('books').filter((b) => b.ten_sach === 'Sách Mới' && b.trang_thai === 'co_san').length;
    await call('POST', '/librarian/book/increase', 'tt', { ten_sach: 'Sách Mới' }); eq(n(), 4);
    await call('POST', '/librarian/book/decrease', 'tt', { ten_sach: 'Sách Mới' }); eq(n(), 3);
    await call('POST', '/librarian/book/set-stock', 'tt', { ten_sach: 'Sách Mới', so_luong: 7 }); eq(n(), 7);
    await call('POST', '/librarian/book/set-stock', 'tt', { ten_sach: 'Sách Mới', so_luong: 2 }); eq(n(), 2);
    eq((await call('POST', '/librarian/book/set-stock', 'tt', { ten_sach: 'Sách Mới', so_luong: 'abc' })).status, 400);
    assert(new Set(db.all('books').map((b) => b.ma_vach)).size === db.all('books').length, 'mã vạch bị trùng');
  });
  await t('sửa tên: chặn trùng với đầu sách khác', async () => {
    eq((await call('POST', '/librarian/book/edit', 'tt', { old_title: 'Sách Mới', new_title: 'Marketing Căn bản', tac_gia: '', vi_tri_ke: '' })).status, 400);
    eq((await call('POST', '/librarian/book/edit', 'tt', { old_title: 'Sách Mới', new_title: 'Sách Mới 2', tac_gia: 'TG', vi_tri_ke: 'K9' })).status, 200);
    eq(db.all('books').filter((b) => b.ten_sach === 'Sách Mới 2' && b.vi_tri_ke === 'K9').length, 2);
  });
  await t('xóa đầu sách: chặn khi đang được giữ, cho phép khi chỉ còn sách hỏng', async () => {
    const held = db.all('books').find((b) => b.trang_thai === 'da_dat_giu');
    assert(held);
    eq((await call('POST', '/librarian/book/delete-group', 'tt', { ten_sach: held.ten_sach })).status, 400);
    eq((await call('POST', '/librarian/book/delete-group', 'tt', { ten_sach: 'Sách Mới 2' })).status, 200);
    eq(db.all('books').filter((b) => b.ten_sach === 'Sách Mới 2').length, 0);
    const dmg = db.all('books').find((b) => b.trang_thai === 'hu_hong');
    const others = db.all('books').filter((b) => b.ten_sach === dmg.ten_sach && b.trang_thai !== 'hu_hong' && b.trang_thai !== 'co_san');
    if (!others.length) eq((await call('POST', '/librarian/book/delete-group', 'tt', { ten_sach: dmg.ten_sach })).status, 200);
  });
  await t('lịch sử vẫn hiện khi sách đã bị xóa khỏi kho', async () => {
    const r = await call('GET', '/student/history/2', 'sv1');
    assert(r.json.length >= 2 && r.json.every((x) => x.ten_sach));
  });
  await t('mỗi thay đổi đều cập nhật tín hiệu meta/sync', async () => assert(db.get('meta', 'sync').rev > 0));

  console.log(`\n${pass} đạt, ${failN} lỗi (${db.txCount} transaction)`);
  process.exit(failN ? 1 : 0);
})();
