/* Firebase dùng chung cho student / librarian / kiosk (bản compat, nạp bằng <script> thường).
   - Mỗi trang có phiên đăng nhập riêng nên đăng nhập ở trang này không đè trang kia.
   - Tự gắn "Authorization: Bearer <token>" vào mọi fetch('/api/...').
   - watchSync: nghe tài liệu meta/sync (Rules chỉ cho kiosk và thủ thư đọc) để biết lúc nào cần tải lại. */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyB1qtSFNNFmVWAo0r0lqIU5cEfCGOKX59M",
    authDomain: "due-smart-locker.firebaseapp.com",
    projectId: "due-smart-locker",
    appId: "1:639064006349:web:ea10677c76872b13989384",
  };

  const DOMAIN = "@due.udn.vn";
  const p = location.pathname;
  const page = p.indexOf("kiosk") >= 0 ? "kiosk" : p.indexOf("librarian") >= 0 ? "librarian" : "student";

  const app = firebase.initializeApp(firebaseConfig, page);
  const auth = app.auth();
  const db = typeof app.firestore === "function" ? app.firestore() : null;
  // Sinh viên: đóng tab là đăng xuất (máy dùng chung). Thủ thư và kiosk giữ phiên.
  const persist = auth.setPersistence(
    page === "student" ? firebase.auth.Auth.Persistence.SESSION : firebase.auth.Auth.Persistence.LOCAL
  );

  const MSG = {
    "auth/invalid-credential": "Sai tài khoản hoặc mật khẩu.",
    "auth/wrong-password": "Sai tài khoản hoặc mật khẩu.",
    "auth/user-not-found": "Sai tài khoản hoặc mật khẩu.",
    "auth/invalid-email": "Tài khoản không hợp lệ.",
    "auth/user-disabled": "Tài khoản đã bị khóa.",
    "auth/too-many-requests": "Thử sai quá nhiều lần, vui lòng đợi vài phút.",
    "auth/network-request-failed": "Lỗi kết nối mạng.",
    "auth/weak-password": "Mật khẩu mới phải có ít nhất 6 ký tự.",
    "auth/requires-recent-login": "Vui lòng đăng nhập lại rồi đổi mật khẩu.",
  };
  const errMsg = (e) => MSG[e && e.code] || (e && e.message) || "Đã có lỗi xảy ra.";

  async function login(id, password) {
    await persist;
    const email = String(id).trim().toLowerCase();
    return auth.signInWithEmailAndPassword(email.indexOf("@") >= 0 ? email : email + DOMAIN, password);
  }

  async function changePassword(oldPass, newPass) {
    const user = auth.currentUser;
    if (!user) throw new Error("Bạn chưa đăng nhập.");
    try {
      await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, oldPass));
    } catch (e) {
      if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") throw new Error("Mật khẩu hiện tại không chính xác!");
      throw e;
    }
    await user.updatePassword(newPass);
  }

  // Kiểm tra role (custom claim) thật của tài khoản, không dựa vào chữ trong email.
  function watch(roles, handlers) {
    auth.onAuthStateChanged(async (user) => {
      if (!user) return handlers.onOut();
      try {
        const r = await user.getIdTokenResult(true);
        if (roles.indexOf(r.claims.role) >= 0) return handlers.onIn(user, r.claims.role);
        await auth.signOut();
        handlers.onOut("Tài khoản này không có quyền truy cập trang này.");
      } catch (e) { handlers.onOut(errMsg(e)); }
    });
  }

  // Gọi cb mỗi khi dữ liệu trên server đổi (bỏ qua lần đầu vì trang đã tự tải rồi).
  function watchSync(cb) {
    if (!db) return function () {};
    let first = true, timer;
    return db.doc("meta/sync").onSnapshot(function () {
      if (first) { first = false; return; }
      clearTimeout(timer);
      timer = setTimeout(cb, 250);
    }, function (e) { console.warn("Không nghe được tín hiệu đồng bộ:", e.code); });
  }

  // Gắn token vào mọi request /api/
  const rawFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    init = init || {};
    const url = typeof input === "string" ? input : input.url;
    if (url.indexOf("/api/") === 0 && auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      init = Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, { Authorization: "Bearer " + token }) });
    }
    return rawFetch(input, init);
  };

  window.fbAuth = {
    auth: auth, db: db, errMsg: errMsg, login: login, changePassword: changePassword, watch: watch, watchSync: watchSync,
    logout: function () { return auth.signOut(); },
    ready: new Promise(function (res) { const un = auth.onAuthStateChanged(function (u) { un(); res(u); }); }),
  };
})();
