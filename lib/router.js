'use strict';
/**
 * Một hàm serverless duy nhất xử lý toàn bộ /api/* (gói Hobby của Vercel giới hạn 12 hàm).
 * Mỗi route khai báo rõ role được phép. Route không khai báo thì 404 (mặc định từ chối).
 * Role nằm trong custom claim `role` của Firebase ID token: sinh_vien | thu_thu | kiosk.
 */
const { HttpError } = require('./service');

const SV = ['sinh_vien'];
const TT = ['thu_thu'];
const KIOSK = ['kiosk', 'thu_thu'];

function buildRoutes(svc) {
  // [method, path, roles, handler(ctx, body, params), options]
  return [
    ['GET', '/me', ['sinh_vien', 'thu_thu', 'kiosk'], (c) => svc.me(c)],

    // Sinh viên
    ['GET', '/books', ['sinh_vien', 'thu_thu'], () => svc.booksForStudent()],
    ['POST', '/reserve', SV, (c, b) => svc.reserve(c, b)],
    ['GET', '/student/pending', SV, (c) => svc.studentPending(c)],
    ['GET', '/student/borrowed/:id', SV, (c) => svc.studentBorrowed(c), { own: true }],
    ['GET', '/student/history/:id', SV, (c) => svc.studentHistory(c), { own: true }],
    ['POST', '/student/create-return-qr', SV, (c, b) => svc.createReturnQr(c, b)],
    ['POST', '/student/login', null, null, { gone: true }],           // đã chuyển sang Firebase Auth
    ['POST', '/student/change-password', null, null, { gone: true }], // đã chuyển sang Firebase Auth

    // Thủ thư
    ['POST', '/books', TT, (c, b) => svc.addBook(c, b)],
    ['GET', '/librarian/books-grouped', TT, () => svc.booksGrouped()],
    ['POST', '/librarian/book/increase', TT, (c, b) => svc.increase(c, b)],
    ['POST', '/librarian/book/decrease', TT, (c, b) => svc.decrease(c, b)],
    ['POST', '/librarian/book/set-stock', TT, (c, b) => svc.setStock(c, b)],
    ['POST', '/librarian/book/edit', TT, (c, b) => svc.editBook(c, b)],
    ['POST', '/librarian/book/delete-group', TT, (c, b) => svc.deleteGroup(c, b)],
    ['GET', '/librarian/orders', TT, () => svc.orders()],
    ['POST', '/librarian/ready-group', TT, (c, b) => svc.readyGroup(c, b)],
    ['POST', '/librarian/cancel-expired-group', TT, (c, b) => svc.cancelGroup(c, b)],
    ['GET', '/librarian/returns-inspect', TT, () => svc.returnsInspect()],
    ['GET', '/librarian/active-borrows', TT, () => svc.activeBorrows()],
    ['POST', '/librarian/inspect-book', TT, (c, b) => svc.inspectBook(c, b)],
    ['POST', '/librarian/collect-all', TT, () => svc.collectAll()],

    // Kiosk
    ['GET', '/lockers', KIOSK, () => svc.lockers()],
    ['POST', '/locker/pickup', KIOSK, (c, b) => svc.pickup(c, b)],
    ['POST', '/locker/return', KIOSK, (c, b) => svc.returnByBarcode(c, b)],
  ].map(([method, path, roles, fn, opts = {}]) => {
    const names = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
    return { method, re, names, roles, fn, ...opts };
  });
}

function matchRoute(routes, method, path) {
  let pathHit = false;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathHit = true;
    if (r.method !== method) continue;
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    return { route: r, params };
  }
  return { route: null, pathHit };
}

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (typeof b === 'string' && b.trim()) {
    try { return JSON.parse(b); } catch (e) { throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ!'); }
  }
  return {};
}

/** verify(token) -> claims (ném lỗi nếu sai). Truyền vào để test được mà không cần Firebase thật. */
function createHandler({ svc, verify }) {
  const routes = buildRoutes(svc);

  return async function handler(req, res) {
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(payload));
    };
    try {
      const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/api/, '') || '/';
      const { route, params, pathHit } = matchRoute(routes, req.method, path);
      if (!route) return send(pathHit ? 405 : 404, { detail: pathHit ? 'Phương thức không được hỗ trợ.' : 'Không tìm thấy.' });
      if (route.gone) return send(410, { detail: 'Đăng nhập và đổi mật khẩu nay do Firebase quản lý.' });

      const header = String(req.headers.authorization || '');
      if (!header.startsWith('Bearer ')) return send(401, { detail: 'Thiếu thông tin đăng nhập.' });
      let claims;
      try { claims = await verify(header.slice(7)); } catch (e) { return send(401, { detail: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }); }
      if (!route.roles.includes(claims.role)) return send(403, { detail: 'Bạn không có quyền thực hiện thao tác này.' });

      const ctx = { role: claims.role, email: claims.email || '', uid: claims.uid || claims.sub };
      if (claims.role === 'sinh_vien') {
        ctx.user = await svc.loadStudent(ctx.email);
        if (!ctx.user) return send(403, { detail: 'Mã số sinh viên không thuộc danh sách sinh viên trường DUE!' });
        if (route.own && Number(params.id) !== ctx.user.id) return send(403, { detail: 'Bạn chỉ được xem dữ liệu của chính mình.' });
      }
      const body = req.method === 'GET' ? {} : readBody(req);
      return send(200, await route.fn(ctx, body, params));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { detail: e.detail });
      console.error('API error:', e);
      return send(500, { detail: 'Lỗi máy chủ, vui lòng thử lại.' });
    }
  };
}

module.exports = { createHandler };
