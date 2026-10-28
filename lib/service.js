'use strict';
/**
 * Nghiệp vụ DUE Smart Locker trên Firestore (port từ app.py / SQLite).
 * Mọi thao tác ghi dùng transaction: đọc hết trước, ghi sau. Nhờ đó không thể
 * có hai đơn cùng nhận một hộc hay cùng giữ một cuốn sách.
 *
 * Collections: users (id tài liệu = MSSV), books (mỗi bản sao 1 tài liệu), lockers,
 * reservations (mỗi cuốn trong đơn 1 tài liệu), counters, meta/sync.
 */
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, detail) { super(detail); this.status = status; this.detail = detail; }
}
const fail = (status, detail) => { throw new HttpError(status, detail); };

const CFG = {
  LOAN_DAYS: 14,
  FINE_PER_DAY: 5000,
  RETURN_HOLD_MS: 2 * 3600 * 1000, // giữ hộc cho mã QR trả sách trong 2 giờ
  MAX_BOOKS_PER_ORDER: 10,
  MAX_PENDING_ORDERS: 2,           // số đơn chờ nhận tối đa của mỗi sinh viên
  MAX_COPIES_PER_CALL: 200,
};

const DAY = 86400000;
const vnNow = () => Date.now() + 7 * 3600 * 1000; // giờ Việt Nam (server Vercel chạy UTC)
const dateStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayStr = () => dateStr(vnNow());
const dueStr = () => dateStr(vnNow() + CFG.LOAN_DAYS * DAY);
function daysLate(hanTra) {
  if (!hanTra) return 0;
  const due = Date.parse(hanTra + 'T00:00:00Z');
  if (Number.isNaN(due)) return 0;
  return Math.max(0, Math.floor((vnNow() - due) / DAY));
}
const token = (prefix) => prefix + crypto.randomBytes(5).toString('hex').toUpperCase();
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const FREE = { trang_thai: 'trong', reservation_id: null, token: null, hold_until: null };
const isFree = (l) => l.trang_thai === 'trong' || (l.trang_thai === 'cho_tra' && (l.hold_until || 0) < Date.now());
const toInt = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

function createService(db) {
  const C = (n) => db.collection(n);
  const ref = (n, id) => C(n).doc(String(id));
  const eq = (col, f, v) => C(col).where(f, '==', v);
  const syncRef = db.doc('meta/sync');
  const touch = (w) => w.set(syncRef, { rev: Date.now() + Math.random() }); // báo cho kiosk / thủ thư tải lại
  const docs = (qs) => qs.docs.map((d) => d.data());

  async function getMany(col, ids, tx) {
    const uniq = [...new Set(ids.filter((i) => i !== null && i !== undefined).map(String))];
    const out = new Map();
    if (!uniq.length) return out;
    const refs = uniq.map((i) => ref(col, i));
    const snaps = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
    snaps.forEach((s) => { if (s.exists) out.set(s.id, s.data()); });
    return out;
  }
  async function allLockers(tx) {
    const qs = tx ? await tx.get(C('lockers')) : await C('lockers').get();
    return docs(qs).sort((a, b) => a.id - b.id);
  }
  async function readCounter(tx, name) {
    const s = await tx.get(ref('counters', name));
    if (s.exists) return s.data().next;
    const top = await tx.get(C(name).orderBy('id', 'desc').limit(1)); // chưa có bộ đếm: tính từ id lớn nhất hiện có
    return top.empty ? 1 : top.docs[0].data().id + 1;
  }
  const writeCounter = (tx, name, next) => tx.set(ref('counters', name), { next });

  async function existingCodes(tx, codes) {
    const found = new Set();
    const parts = await Promise.all(chunk(codes, 10).map((p) => tx.get(C('books').where('ma_vach', 'in', p))));
    parts.forEach((qs) => qs.docs.forEach((d) => found.add(d.data().ma_vach)));
    return found;
  }
  async function freshCodes(tx, n) {
    const out = [];
    while (out.length < n) {
      const cand = [...new Set(Array.from({ length: n - out.length }, () => 'DUE-' + crypto.randomBytes(3).toString('hex').toUpperCase()))];
      const used = await existingCodes(tx, cand);
      cand.forEach((c) => { if (!used.has(c) && !out.includes(c)) out.push(c); });
    }
    return out;
  }

  // ---------- NGƯỜI DÙNG ----------
  async function loadStudent(email) {
    const mssv = String(email || '').split('@')[0].trim();
    if (!mssv) return null;
    const s = await ref('users', mssv).get();
    if (!s.exists) return null;
    const u = s.data();
    return u.vai_tro === 'sinh_vien' ? u : null;
  }
  async function me(ctx) {
    if (ctx.role !== 'sinh_vien') return { role: ctx.role, email: ctx.email };
    const u = ctx.user;
    return { role: 'sinh_vien', id: u.id, mssv: u.mssv, ho_ten: u.ho_ten, email: u.email, tien_no_phat: u.tien_no_phat || 0 };
  }

  // ---------- KHO SÁCH ----------
  async function groupBooks() {
    const all = docs(await C('books').get());
    const groups = new Map();
    for (const b of all) {
      let g = groups.get(b.ten_sach);
      if (!g) { g = { rep: b, items: [] }; groups.set(b.ten_sach, g); }
      g.items.push(b);
      if (b.id < g.rep.id) g.rep = b;
    }
    return [...groups.values()].map((g) => {
      const avail = g.items.filter((x) => x.trang_thai === 'co_san').length;
      return {
        id: g.rep.id, ten_sach: g.rep.ten_sach, tac_gia: g.rep.tac_gia, vi_tri_ke: g.rep.vi_tri_ke,
        ma_vach: g.items.map((x) => x.ma_vach).sort()[0],
        tong: g.items.length, avail, busy: g.items.length - avail,
      };
    }).sort((a, b) => a.ten_sach.localeCompare(b.ten_sach, 'vi'));
  }
  async function booksForStudent() {
    return (await groupBooks()).map((g) => ({
      id: g.id, ten_sach: g.ten_sach, tac_gia: g.tac_gia, vi_tri_ke: g.vi_tri_ke, ma_vach: g.ma_vach,
      tong_so_luong: g.tong, so_luong_con: g.avail, trang_thai: g.avail > 0 ? 'co_san' : 'het_sach',
    }));
  }
  async function booksGrouped() {
    return (await groupBooks()).map((g) => ({
      ten_sach: g.ten_sach, tac_gia: g.tac_gia, vi_tri_ke: g.vi_tri_ke, tong_so_luong: g.tong,
      so_luong_co_san: g.avail, so_luong_dang_muon: g.busy, ma_vach_dai_dien: g.ma_vach,
    }));
  }
  const needTitle = (body) => {
    const t = String(body.ten_sach || '').trim();
    if (!t) fail(400, 'Thiếu tên sách!');
    return t;
  };

  async function increase(ctx, body) {
    const title = needTitle(body);
    return db.runTransaction(async (tx) => {
      const sample = await tx.get(eq('books', 'ten_sach', title).limit(1));
      if (sample.empty) fail(404, 'Không tìm thấy thông tin sách!');
      const s = sample.docs[0].data();
      const base = await readCounter(tx, 'books');
      const [code] = await freshCodes(tx, 1);
      tx.set(ref('books', base), { id: base, ma_vach: code, ten_sach: title, tac_gia: s.tac_gia, vi_tri_ke: s.vi_tri_ke, gia_bia: s.gia_bia, trang_thai: 'co_san' });
      writeCounter(tx, 'books', base + 1);
      touch(tx);
      return { status: 'success', message: `Đã thêm 1 cuốn '${title}' vào kho!` };
    });
  }
  async function decrease(ctx, body) {
    const title = needTitle(body);
    return db.runTransaction(async (tx) => {
      const avail = docs(await tx.get(eq('books', 'ten_sach', title).where('trang_thai', '==', 'co_san'))).sort((a, b) => b.id - a.id);
      if (!avail.length) fail(400, 'Không thể giảm! Tất cả các cuốn của giáo trình này đều đang được giữ hoặc mượn.');
      tx.delete(ref('books', avail[0].id));
      touch(tx);
      return { status: 'success', message: `Đã giảm 1 cuốn '${title}' khỏi kho!` };
    });
  }
  async function setStock(ctx, body) {
    const title = needTitle(body);
    const target = toInt(body.so_luong);
    if (Number.isNaN(target)) fail(400, 'Số lượng phải là số nguyên!');
    const want = Math.max(0, target);
    return db.runTransaction(async (tx) => {
      const avail = docs(await tx.get(eq('books', 'ten_sach', title).where('trang_thai', '==', 'co_san'))).sort((a, b) => a.id - b.id);
      if (want > avail.length) {
        const diff = want - avail.length;
        if (diff > CFG.MAX_COPIES_PER_CALL) fail(400, `Mỗi lần chỉ được thêm tối đa ${CFG.MAX_COPIES_PER_CALL} cuốn!`);
        const sample = await tx.get(eq('books', 'ten_sach', title).limit(1));
        if (sample.empty) fail(404, 'Không tìm thấy sách!');
        const s = sample.docs[0].data();
        const base = await readCounter(tx, 'books');
        const codes = await freshCodes(tx, diff);
        codes.forEach((code, i) => tx.set(ref('books', base + i), { id: base + i, ma_vach: code, ten_sach: title, tac_gia: s.tac_gia, vi_tri_ke: s.vi_tri_ke, gia_bia: s.gia_bia, trang_thai: 'co_san' }));
        writeCounter(tx, 'books', base + diff);
      } else if (want < avail.length) {
        avail.slice(want).forEach((b) => tx.delete(ref('books', b.id))); // bỏ các bản có id lớn nhất
      }
      touch(tx);
      return { status: 'success', message: `Đã lưu thành công số lượng '${title}': ${want} cuốn có sẵn!` };
    });
  }
  async function bulk(ops) {
    for (const part of chunk(ops, 400)) {
      const b = db.batch();
      part.forEach((op) => op(b));
      await b.commit();
    }
  }
  async function editBook(ctx, body) {
    const oldT = String(body.old_title || '').trim();
    const newT = String(body.new_title || '').trim();
    if (!oldT || !newT) fail(400, 'Tên sách không được để trống!');
    const copies = docs(await eq('books', 'ten_sach', oldT).get());
    if (!copies.length) fail(404, 'Không tìm thấy giáo trình cần sửa!');
    if (newT !== oldT && !(await eq('books', 'ten_sach', newT).limit(1).get()).empty) {
      fail(400, 'Đã có giáo trình khác trùng tên này, hãy chọn tên khác!');
    }
    const patch = { ten_sach: newT, tac_gia: String(body.tac_gia || '').trim(), vi_tri_ke: String(body.vi_tri_ke || '').trim() };
    await bulk([...copies.map((b) => (w) => w.update(ref('books', b.id), patch)), (w) => touch(w)]);
    return { status: 'success', message: `Đã cập nhật thông tin thành công cho giáo trình '${newT}'!` };
  }
  async function deleteGroup(ctx, body) {
    const title = String(body.ten_sach || '').trim();
    if (!title) fail(400, 'Thiếu tên sách cần xóa!');
    const copies = docs(await eq('books', 'ten_sach', title).get());
    if (!copies.length) fail(404, 'Không tìm thấy giáo trình!');
    const busy = copies.filter((b) => !['co_san', 'hu_hong'].includes(b.trang_thai)).length;
    if (busy > 0) fail(400, `Không thể xóa! Hiện có ${busy} cuốn của giáo trình này đang được sinh viên mượn hoặc giữ chỗ tại tủ.`);
    await bulk([...copies.map((b) => (w) => w.delete(ref('books', b.id))), (w) => touch(w)]);
    return { status: 'success', message: `Đã xóa toàn bộ giáo trình '${title}' khỏi hệ thống thư viện!` };
  }
  async function addBook(ctx, body) {
    const title = String(body.ten_sach || '').trim();
    const baseCode = String(body.ma_vach || '').trim().toUpperCase();
    if (!title || !baseCode) fail(400, 'Vui lòng nhập mã vạch và tên sách!');
    const qty = Math.min(CFG.MAX_COPIES_PER_CALL, Math.max(1, toInt(body.so_luong) || 1));
    const price = Math.max(0, toInt(body.gia_bia) || 120000);
    const codes = Array.from({ length: qty }, (_, i) => (qty === 1 ? baseCode : `${baseCode}-${String(i + 1).padStart(2, '0')}`));
    return db.runTransaction(async (tx) => {
      if ((await existingCodes(tx, codes)).size) fail(400, 'Mã vạch này đã tồn tại trong kho thư viện!');
      const base = await readCounter(tx, 'books');
      codes.forEach((code, i) => tx.set(ref('books', base + i), {
        id: base + i, ma_vach: code, ten_sach: title, tac_gia: String(body.tac_gia || '').trim(),
        vi_tri_ke: String(body.vi_tri_ke || '').trim(), gia_bia: price, trang_thai: 'co_san',
      }));
      writeCounter(tx, 'books', base + qty);
      touch(tx);
      return { status: 'success', message: `Đã thêm thành công ${qty} cuốn '${title}' vào kho!` };
    });
  }

  // ---------- HỘC TỦ ----------
  async function lockers() {
    return (await allLockers()).map((l) => ({
      id: l.id, so_hoc: l.so_hoc, reservation_id: l.reservation_id ?? null,
      trang_thai: isFree(l) ? 'trong' : l.trang_thai, // hộc giữ chỗ trả sách đã hết hạn coi như trống
    }));
  }

  // ---------- SINH VIÊN ----------
  async function reserve(ctx, body) {
    const bookIds = (Array.isArray(body.book_ids) ? body.book_ids : []).map(Number);
    if (!bookIds.length) fail(400, 'Giỏ hàng chưa có sách nào!');
    if (bookIds.some((n) => !Number.isInteger(n))) fail(400, 'Dữ liệu giỏ hàng không hợp lệ!');
    if (bookIds.length > CFG.MAX_BOOKS_PER_ORDER) fail(400, `Mỗi đơn chỉ được mượn tối đa ${CFG.MAX_BOOKS_PER_ORDER} cuốn!`);
    const ngayHen = String(body.ngay_hen || '');
    const khungGio = String(body.khung_gio || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayHen) || ngayHen < todayStr() || ngayHen > dateStr(vnNow() + 30 * DAY)) fail(400, 'Ngày hẹn nhận sách không hợp lệ!');
    if (!khungGio || khungGio.length > 30) fail(400, 'Khung giờ hẹn không hợp lệ!');
    const mssv = ctx.user.mssv;

    return db.runTransaction(async (tx) => {
      const user = (await tx.get(ref('users', mssv))).data();
      if ((user.tien_no_phat || 0) > 0) fail(400, 'Tài khoản đang nợ phạt, vui lòng thanh toán trước khi mượn!');

      const pend = [
        ...docs(await tx.get(eq('reservations', 'user_id', user.id).where('trang_thai_don', '==', 'cho_soan'))),
        ...docs(await tx.get(eq('reservations', 'user_id', user.id).where('trang_thai_don', '==', 'da_soan_xong'))),
      ];
      if (new Set(pend.map((r) => r.qr_token)).size >= CFG.MAX_PENDING_ORDERS) {
        fail(400, `Bạn đang có ${CFG.MAX_PENDING_ORDERS} đơn chờ nhận sách, vui lòng nhận sách trước khi đặt thêm!`);
      }

      const reps = await getMany('books', bookIds, tx);
      const titleOf = bookIds.map((id) => {
        const r = reps.get(String(id));
        if (!r) fail(400, 'Không tìm thấy thông tin giáo trình!');
        return r.ten_sach;
      });
      const need = new Map();
      titleOf.forEach((t) => need.set(t, (need.get(t) || 0) + 1));
      const pools = new Map();
      for (const [title, n] of need) {
        const avail = docs(await tx.get(eq('books', 'ten_sach', title).where('trang_thai', '==', 'co_san'))).sort((a, b) => a.id - b.id);
        if (avail.length < n) fail(400, `Giáo trình '${title}' vừa hết hàng!`);
        pools.set(title, avail);
      }
      const locker = (await allLockers(tx)).find(isFree);
      if (!locker) fail(400, 'Tất cả các hộc tủ Smart Locker hiện đã đầy!');
      const base = await readCounter(tx, 'reservations');

      const qr = token('QR-');
      titleOf.forEach((title, i) => {
        const copy = pools.get(title).shift();
        tx.set(ref('reservations', base + i), {
          id: base + i, user_id: user.id, user_mssv: mssv, book_id: copy.id, locker_id: locker.id,
          ngay_hen: ngayHen, khung_gio: khungGio, qr_token: qr, ngay_muon: null, han_tra: null,
          ngay_tra: null, tien_phat: 0, trang_thai_don: 'cho_soan',
        });
        tx.update(ref('books', copy.id), { trang_thai: 'da_dat_giu' });
      });
      tx.update(ref('lockers', locker.id), { trang_thai: 'cho_nhan', reservation_id: base, token: qr, hold_until: null });
      writeCounter(tx, 'reservations', base + bookIds.length);
      touch(tx);
      return {
        status: 'success', count: bookIds.length, primary_qr: qr, all_lockers: locker.so_hoc,
        book_titles: titleOf.join(', '),
        message: `Đặt hẹn thành công ${bookIds.length} cuốn sách! Đã cấp duy nhất: ${locker.so_hoc}.`,
      };
    });
  }

  async function studentBorrowed(ctx) {
    const rows = docs(await eq('reservations', 'user_id', ctx.user.id).where('trang_thai_don', '==', 'dang_muon').get()).sort((a, b) => b.id - a.id);
    const books = await getMany('books', rows.map((r) => r.book_id));
    return rows.map((r) => {
      const b = books.get(String(r.book_id)) || {};
      return {
        res_id: r.id, book_id: r.book_id, ten_sach: b.ten_sach || '(Sách đã xóa khỏi kho)', ma_vach: b.ma_vach || '',
        vi_tri_ke: b.vi_tri_ke || '', ngay_muon: r.ngay_muon, han_tra: r.han_tra, trang_thai_don: r.trang_thai_don,
      };
    });
  }
  async function studentHistory(ctx) {
    const rows = docs(await eq('reservations', 'user_id', ctx.user.id).get()).sort((a, b) => b.id - a.id);
    const books = await getMany('books', rows.map((r) => r.book_id));
    return rows.map((r) => {
      const b = books.get(String(r.book_id)) || {};
      return {
        id: r.id, ten_sach: b.ten_sach || '(Sách đã xóa khỏi kho)', ma_vach: b.ma_vach || '', ngay_hen: r.ngay_hen,
        ngay_muon: r.ngay_muon, han_tra: r.han_tra, ngay_tra: r.ngay_tra, tien_phat: r.tien_phat, trang_thai_don: r.trang_thai_don,
      };
    });
  }
  // Mã QR đang có hiệu lực: giúp sinh viên xem lại khi tải lại trang
  async function studentPending(ctx) {
    const uid = ctx.user.id;
    const [a, b, c] = await Promise.all(['cho_soan', 'da_soan_xong', 'dang_muon'].map((s) => eq('reservations', 'user_id', uid).where('trang_thai_don', '==', s).get()));
    const pickRows = [...docs(a), ...docs(b)];
    const lk = new Map((await allLockers()).map((l) => [l.id, l]));
    const groups = new Map();
    pickRows.forEach((r) => { if (!groups.has(r.qr_token)) groups.set(r.qr_token, []); groups.get(r.qr_token).push(r); });
    const pickup = [...groups.entries()].map(([qr, rs]) => ({
      qr_token: qr, so_hoc: (lk.get(rs[0].locker_id) || {}).so_hoc || '', ngay_hen: rs[0].ngay_hen, khung_gio: rs[0].khung_gio,
      count: rs.length, san_sang: rs.every((r) => r.trang_thai_don === 'da_soan_xong'), _id: Math.max(...rs.map((r) => r.id)),
    })).sort((x, y) => y._id - x._id).map(({ _id, ...rest }) => rest);

    const retGroups = new Map();
    docs(c).filter((r) => (r.qr_token || '').startsWith('TRA-')).forEach((r) => {
      if (!retGroups.has(r.qr_token)) retGroups.set(r.qr_token, []);
      retGroups.get(r.qr_token).push(r);
    });
    let ret = null;
    [...retGroups.entries()].sort((x, y) => Math.max(...y[1].map((r) => r.id)) - Math.max(...x[1].map((r) => r.id))).some(([qr, rs]) => {
      const l = lk.get(rs[0].locker_id);
      if (l && l.trang_thai === 'cho_tra' && l.token === qr) { ret = { qr_token: qr, so_hoc: l.so_hoc, count: rs.length }; return true; }
      return false;
    });
    return { tien_no_phat: ctx.user.tien_no_phat || 0, pickup, return: ret };
  }

  async function createReturnQr(ctx, body) {
    const ids = [...new Set((Array.isArray(body.reservation_ids) ? body.reservation_ids : []).map(Number).filter(Number.isInteger))];
    if (!ids.length) fail(400, 'Vui lòng tick chọn ít nhất 1 cuốn sách để trả!');
    if (ids.length > 50) fail(400, 'Số lượng sách chọn quá lớn!');
    return db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...ids.map((i) => ref('reservations', i)));
      const valid = snaps.filter((s) => s.exists).map((s) => s.data()).filter((r) => r.user_id === ctx.user.id && r.trang_thai_don === 'dang_muon');
      if (!valid.length) fail(400, 'Không có cuốn sách hợp lệ để trả!');
      const all = await allLockers(tx);
      const oldTokens = new Set(valid.map((r) => r.qr_token).filter((t) => t && t.startsWith('TRA-')));
      const mine = (l) => l.trang_thai === 'cho_tra' && oldTokens.has(l.token);
      const locker = all.find((l) => isFree(l) || mine(l));
      if (!locker) fail(400, 'Hiện tại tủ Smart Locker đã đầy, không còn hộc trống để nhận sách trả!');

      const qr = token('TRA-');
      valid.forEach((r) => tx.update(ref('reservations', r.id), { qr_token: qr, locker_id: locker.id }));
      tx.update(ref('lockers', locker.id), { trang_thai: 'cho_tra', token: qr, hold_until: Date.now() + CFG.RETURN_HOLD_MS, reservation_id: valid[0].id });
      all.filter((l) => l.id !== locker.id && mine(l)).forEach((l) => tx.update(ref('lockers', l.id), FREE)); // nhả hộc của mã cũ
      touch(tx);
      return {
        status: 'success', qr_token: qr, so_hoc: locker.so_hoc, count: valid.length,
        message: `Đã tạo mã QR trả cho ${valid.length} cuốn sách! Hộc nhận dự kiến: ${locker.so_hoc}.`,
      };
    });
  }

  // ---------- THỦ THƯ ----------
  async function orders() {
    const [a, b] = await Promise.all(['cho_soan', 'da_soan_xong'].map((s) => eq('reservations', 'trang_thai_don', s).get()));
    const rows = [...docs(a), ...docs(b)].sort((x, y) => y.id - x.id);
    const [users, books, lk] = await Promise.all([
      getMany('users', rows.map((r) => r.user_mssv)), getMany('books', rows.map((r) => r.book_id)), getMany('lockers', rows.map((r) => r.locker_id)),
    ]);
    const grouped = new Map();
    rows.forEach((r) => {
      const u = users.get(String(r.user_mssv)) || {};
      const bk = books.get(String(r.book_id)) || {};
      const l = lk.get(String(r.locker_id)) || {};
      if (!grouped.has(r.qr_token)) {
        grouped.set(r.qr_token, {
          qr_token: r.qr_token, ho_ten: u.ho_ten, mssv: u.mssv, so_hoc: l.so_hoc, locker_id: r.locker_id,
          ngay_hen: r.ngay_hen, khung_gio: r.khung_gio, trang_thai_don: r.trang_thai_don, books: [],
        });
      }
      grouped.get(r.qr_token).books.push({ res_id: r.id, ten_sach: bk.ten_sach, vi_tri_ke: bk.vi_tri_ke, ma_vach: bk.ma_vach });
    });
    return [...grouped.values()];
  }
  const needToken = (body) => {
    const t = String(body.qr_token || '').trim();
    if (!t) fail(400, 'Thiếu mã token!');
    return t;
  };
  async function readyGroup(ctx, body) {
    const t = needToken(body);
    return db.runTransaction(async (tx) => {
      const rows = docs(await tx.get(eq('reservations', 'qr_token', t))).filter((r) => ['cho_soan', 'da_soan_xong'].includes(r.trang_thai_don));
      if (!rows.length) fail(404, 'Không tìm thấy đơn chờ soạn với mã này!');
      rows.forEach((r) => tx.update(ref('reservations', r.id), { trang_thai_don: 'da_soan_xong' }));
      touch(tx);
      return { status: 'success', message: 'Đã xác nhận nạp toàn bộ sách vào hộc thành công!' };
    });
  }
  async function cancelGroup(ctx, body) {
    const t = needToken(body);
    return db.runTransaction(async (tx) => {
      const rows = docs(await tx.get(eq('reservations', 'qr_token', t))).filter((r) => ['cho_soan', 'da_soan_xong'].includes(r.trang_thai_don));
      if (!rows.length) fail(404, 'Không tìm thấy đơn mượn này hoặc đơn không còn ở trạng thái chờ nhận!');
      const lockerSnap = await tx.get(ref('lockers', rows[0].locker_id));
      rows.forEach((r) => {
        tx.update(ref('books', r.book_id), { trang_thai: 'co_san' });
        tx.update(ref('reservations', r.id), { trang_thai_don: 'da_huy_do_qua_han' });
      });
      if (lockerSnap.exists && lockerSnap.data().token === t) tx.update(ref('lockers', rows[0].locker_id), FREE);
      touch(tx);
      return { status: 'success', message: 'Đã thu hồi toàn bộ sách trong hộc về kho và mở trống tủ!' };
    });
  }
  async function returnsInspect() {
    const rows = docs(await eq('reservations', 'trang_thai_don', 'cho_kiem_tra').get()).sort((a, b) => b.id - a.id);
    const [users, books, lk] = await Promise.all([
      getMany('users', rows.map((r) => r.user_mssv)), getMany('books', rows.map((r) => r.book_id)), getMany('lockers', rows.map((r) => r.locker_id)),
    ]);
    return rows.map((r) => {
      const u = users.get(String(r.user_mssv)) || {};
      const b = books.get(String(r.book_id)) || {};
      const l = lk.get(String(r.locker_id)) || {};
      return { id: r.id, ho_ten: u.ho_ten, mssv: u.mssv, ten_sach: b.ten_sach, ma_vach: b.ma_vach, so_hoc: l.so_hoc, ngay_tra: r.ngay_tra, tien_phat: r.tien_phat };
    });
  }
  async function activeBorrows() {
    const [a, b] = await Promise.all(['dang_muon', 'cho_kiem_tra'].map((s) => eq('reservations', 'trang_thai_don', s).get()));
    const rows = [...docs(a), ...docs(b)];
    const [users, books] = await Promise.all([getMany('users', rows.map((r) => r.user_mssv)), getMany('books', rows.map((r) => r.book_id))]);
    return rows.map((r) => {
      const u = users.get(String(r.user_mssv)) || {};
      const bk = books.get(String(r.book_id)) || {};
      const late = daysLate(r.han_tra);
      return {
        res_id: r.id, user_id: u.id, ho_ten: u.ho_ten, mssv: u.mssv, email: u.email, book_id: r.book_id,
        ten_sach: bk.ten_sach || '(Sách đã xóa khỏi kho)', ma_vach: bk.ma_vach || '', vi_tri_ke: bk.vi_tri_ke || '',
        ngay_muon: r.ngay_muon, han_tra: r.han_tra, trang_thai_don: r.trang_thai_don,
        tien_phat: r.tien_phat || late * CFG.FINE_PER_DAY, is_late: late > 0, days_late: late,
      };
    }).sort((x, y) => String(x.han_tra || '').localeCompare(String(y.han_tra || '')) || String(x.mssv).localeCompare(String(y.mssv)));
  }
  async function inspectBook(ctx, body) {
    const id = toInt(body.reservation_id);
    if (Number.isNaN(id)) fail(400, 'Thiếu mã đơn cần kiểm tra!');
    if (!['binh_thuong', 'hu_hong'].includes(body.tinh_trang)) fail(400, 'Tình trạng sách không hợp lệ!');
    const extra = body.tinh_trang === 'hu_hong' ? toInt(body.tien_phat_them || 0) : 0;
    if (Number.isNaN(extra) || extra < 0) fail(400, 'Số tiền phạt không hợp lệ!');
    return db.runTransaction(async (tx) => {
      const rs = await tx.get(ref('reservations', id));
      if (!rs.exists) fail(404, 'Không tìm thấy đơn sách này!');
      const r = rs.data();
      if (r.trang_thai_don !== 'cho_kiem_tra') fail(400, 'Cuốn sách này đã được kiểm tra hoặc chưa nằm trong hộc trả!');
      const userSnap = await tx.get(ref('users', r.user_mssv));
      const lockerSnap = await tx.get(ref('lockers', r.locker_id));
      const others = docs(await tx.get(eq('reservations', 'locker_id', r.locker_id).where('trang_thai_don', '==', 'cho_kiem_tra'))).filter((x) => x.id !== r.id);

      let msg;
      if (body.tinh_trang === 'binh_thuong') {
        tx.update(ref('books', r.book_id), { trang_thai: 'co_san' });
        tx.update(ref('reservations', r.id), { trang_thai_don: 'hoan_tat' });
        msg = 'Sách nguyên vẹn: Đã hoàn tất và cộng lại kho sách!';
      } else {
        tx.update(ref('books', r.book_id), { trang_thai: 'hu_hong' });
        tx.update(ref('reservations', r.id), { trang_thai_don: 'hoan_tat_hu_hong', tien_phat: (r.tien_phat || 0) + extra });
        if (userSnap.exists) tx.update(userSnap.ref, { tien_no_phat: (userSnap.data().tien_no_phat || 0) + extra });
        msg = `Đã ghi nhận sách hư hỏng: Phạt thêm ${extra.toLocaleString('en-US')} đ vào tài khoản sinh viên!`;
      }
      if (!others.length && lockerSnap.exists && lockerSnap.data().trang_thai === 'chua_sach_tra') tx.update(lockerSnap.ref, FREE);
      touch(tx);
      return { status: 'success', message: msg };
    });
  }
  async function collectAll() {
    const [lq, bq, rq] = await Promise.all([
      eq('lockers', 'trang_thai', 'chua_sach_tra').get(), eq('books', 'trang_thai', 'cho_kiem_tra').get(), eq('reservations', 'trang_thai_don', 'cho_kiem_tra').get(),
    ]);
    const ops = [
      ...docs(lq).map((l) => (w) => w.update(ref('lockers', l.id), FREE)),
      ...docs(bq).map((b) => (w) => w.update(ref('books', b.id), { trang_thai: 'co_san' })),
      ...docs(rq).map((r) => (w) => w.update(ref('reservations', r.id), { trang_thai_don: 'hoan_tat' })),
      (w) => touch(w),
    ];
    await bulk(ops);
    return { status: 'success', message: 'Đã gom toàn bộ sách trả, xếp về kệ và giải phóng hộc tủ!' };
  }

  // ---------- KIOSK ----------
  async function pickup(ctx, body) {
    const tk = String(body.qr_token || '').trim().toUpperCase();
    if (!tk) fail(400, 'Thiếu mã QR!');
    return db.runTransaction(async (tx) => {
      const rows = docs(await tx.get(eq('reservations', 'qr_token', tk))).sort((a, b) => a.id - b.id);

      if (tk.startsWith('TRA-')) { // ---- trả sách ----
        const open = rows.filter((r) => r.trang_thai_don === 'dang_muon');
        if (!open.length) fail(404, 'Mã QR trả sách không hợp lệ hoặc đã được trả trước đó!');
        const lkSnap = await tx.get(ref('lockers', open[0].locker_id));
        const books = await getMany('books', open.map((r) => r.book_id), tx);
        const lk = lkSnap.exists ? lkSnap.data() : null;
        if (!lk || lk.trang_thai !== 'cho_tra' || lk.token !== tk) fail(400, 'Mã QR trả sách đã hết hạn hoặc hộc đã được cấp cho người khác, vui lòng tạo mã mới!');
        const today = todayStr();
        open.forEach((r) => {
          tx.update(ref('reservations', r.id), { trang_thai_don: 'cho_kiem_tra', ngay_tra: today, tien_phat: daysLate(r.han_tra) * CFG.FINE_PER_DAY });
          if (books.has(String(r.book_id))) tx.update(ref('books', r.book_id), { trang_thai: 'cho_kiem_tra' });
        });
        tx.update(lkSnap.ref, { trang_thai: 'chua_sach_tra', reservation_id: open[0].id, token: null, hold_until: null });
        touch(tx);
        return {
          status: 'success', opened_locker: lk.so_hoc, ten_sach: open.map((r) => (books.get(String(r.book_id)) || {}).ten_sach).join(', '),
          message: `Chốt điện mở ${lk.so_hoc}! Vui lòng bỏ toàn bộ ${open.length} cuốn sách vào hộc và đóng tủ.`,
        };
      }

      // ---- nhận sách ----
      if (!rows.length) fail(404, 'Mã QR/PIN không hợp lệ!');
      if (rows.some((r) => r.trang_thai_don === 'cho_soan')) fail(400, 'Sách đang được thủ thư chuẩn bị, chưa nạp vào hộc!');
      if (rows.some((r) => r.trang_thai_don !== 'da_soan_xong')) fail(400, 'Đơn sách này đã được nhận trước đó!');
      const lkSnap = await tx.get(ref('lockers', rows[0].locker_id));
      const books = await getMany('books', rows.map((r) => r.book_id), tx);
      const today = todayStr();
      const due = dueStr();
      rows.forEach((r) => {
        tx.update(ref('reservations', r.id), { trang_thai_don: 'dang_muon', ngay_muon: today, han_tra: due });
        if (books.has(String(r.book_id))) tx.update(ref('books', r.book_id), { trang_thai: 'dang_muon' });
      });
      const soHoc = lkSnap.exists ? lkSnap.data().so_hoc : '';
      if (lkSnap.exists) tx.update(lkSnap.ref, FREE);
      touch(tx);
      return {
        status: 'success', opened_locker: soHoc, ten_sach: rows.map((r) => (books.get(String(r.book_id)) || {}).ten_sach).join(', '),
        message: `Chốt điện mở ${soHoc}! Vui lòng lấy ${rows.length} cuốn sách và đóng tủ.`,
      };
    });
  }
  async function returnByBarcode(ctx, body) {
    const raw = String(body.ma_vach || '').trim();
    if (!raw) fail(400, 'Thiếu mã vạch sách!');
    return db.runTransaction(async (tx) => {
      let bq = await tx.get(eq('books', 'ma_vach', raw).limit(1));
      if (bq.empty) bq = await tx.get(eq('books', 'ma_vach', raw.toUpperCase()).limit(1));
      const notFound = 'Không tìm thấy lượt mượn nào của cuốn sách này đang mở!';
      if (bq.empty) fail(404, notFound);
      const book = bq.docs[0].data();
      const open = docs(await tx.get(eq('reservations', 'book_id', book.id).where('trang_thai_don', '==', 'dang_muon'))).sort((a, b) => b.id - a.id);
      if (!open.length) fail(404, notFound);
      const r = open[0];
      const locker = (await allLockers(tx)).find(isFree);
      if (!locker) fail(400, 'Tất cả hộc tủ đều đã đầy, không còn chỗ nhận sách trả!');
      const fine = daysLate(r.han_tra) * CFG.FINE_PER_DAY;
      tx.update(ref('reservations', r.id), { trang_thai_don: 'cho_kiem_tra', ngay_tra: todayStr(), tien_phat: fine, locker_id: locker.id });
      tx.update(ref('books', book.id), { trang_thai: 'cho_kiem_tra' });
      tx.update(ref('lockers', locker.id), { trang_thai: 'chua_sach_tra', reservation_id: r.id, token: null, hold_until: null });
      touch(tx);
      return {
        status: 'success', opened_locker: locker.so_hoc, ten_sach: book.ten_sach, tien_phat: fine,
        message: `Mở ${locker.so_hoc} để trả sách. Vui lòng đặt sách vào hộc và đóng cửa tủ.`,
      };
    });
  }

  return {
    loadStudent, me, booksForStudent, booksGrouped, increase, decrease, setStock, editBook, deleteGroup, addBook,
    lockers, reserve, studentBorrowed, studentHistory, studentPending, createReturnQr,
    orders, readyGroup, cancelGroup, returnsInspect, activeBorrows, inspectBook, collectAll, pickup, returnByBarcode,
  };
}

module.exports = { createService, HttpError, CFG };
