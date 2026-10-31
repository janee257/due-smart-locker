/* app-core.js: lõi dùng chung cho student / kiosk / librarian (Firebase compat, 100% client-side).
   - Mỗi trang dùng một Firebase App có TÊN riêng => phiên đăng nhập lưu ở khóa riêng,
     đăng nhập trang này không còn làm văng phiên của trang khác (và không cần signOut khi sai vai trò).
   - Mọi thay đổi kho/hộc tủ đi qua transaction để không lệch dữ liệu giữa các phân hệ. */
(function () {
  const cfg = {
    apiKey: "AIzaSyB1qtSFNNFmVWAo0r0lqIU5cEfCGOKX59M",
    authDomain: "due-smart-locker.firebaseapp.com",
    projectId: "due-smart-locker",
    storageBucket: "due-smart-locker.firebasestorage.app",
    messagingSenderId: "639064006349",
    appId: "1:639064006349:web:ea10677c76872b13989384"
  };
  const p = location.pathname;
  const PAGE = p.indexOf("kiosk") >= 0 ? "kiosk" : p.indexOf("librarian") >= 0 ? "librarian" : "student";
  const app = firebase.initializeApp(cfg, PAGE);
  const auth = app.auth(), db = app.firestore();
  const FV = firebase.firestore.FieldValue;
  const persist = auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);

  const isRole = {
    kiosk: (l) => l.indexOf("kiosk") >= 0,
    librarian: (l) => l.indexOf("thuthu") >= 0,
    student: (l) => l.indexOf("kiosk") < 0 && l.indexOf("thuthu") < 0
  };

  // ---- Đăng nhập / phân quyền (KHÔNG signOut khi sai vai trò) ----
  async function login(id, pw) {
    await persist;
    let e = String(id).trim().toLowerCase();
    if (e.indexOf("@") < 0) e += "@due.udn.vn";
    return auth.signInWithEmailAndPassword(e, pw);
  }
  function watchAuth(onIn, onOut) {
    let lastUid = null;
    auth.onAuthStateChanged((u) => {
      if (!u) { lastUid = null; return onOut(); }
      const local = String(u.email || "").toLowerCase().split("@")[0];
      if (!isRole[PAGE](local)) { lastUid = null; return onOut("Tài khoản này không có quyền truy cập trang này."); }
      if (u.uid === lastUid) return; // token refresh: không khởi tạo lại listener
      lastUid = u.uid;
      onIn(u);
    });
  }

  // ---- Quản lý listener realtime (mỗi key chỉ có 1 listener, tránh nhân đôi) ----
  const subs = {};
  function listen(key, query, cb) {
    if (subs[key]) subs[key]();
    subs[key] = query.onSnapshot((s) => cb(s), (e) => console.error("onSnapshot " + key, e.code || e));
  }
  function stopAll() { Object.keys(subs).forEach((k) => { subs[k](); delete subs[k]; }); }

  // ---- Chuẩn hóa ID ----
  const lockerName = (i) => "Hộc " + (i < 10 ? "0" + i : i);
  const lockerId = (name) => "hoc_" + String(name).replace(/\D/g, "").padStart(2, "0");
  const lockerRef = (name) => db.collection("lockers").doc(lockerId(name));
  const today = () => new Date().toISOString().split("T")[0];

  // Tìm doc sách: book_id -> ma_vach (doc id) -> where ma_vach -> where ten_sach
  async function resolveBookRef(b) {
    const col = db.collection("books");
    for (const id of [b.book_id, b.ma_vach]) {
      if (!id) continue;
      const d = await col.doc(String(id)).get();
      if (d.exists) return d.ref;
    }
    if (b.ma_vach) { const s = await col.where("ma_vach", "==", b.ma_vach).limit(1).get(); if (!s.empty) return s.docs[0].ref; }
    if (b.ten_sach) { const s = await col.where("ten_sach", "==", String(b.ten_sach).trim()).limit(1).get(); if (!s.empty) return s.docs[0].ref; }
    return null;
  }

  // Cộng/trừ tồn kho trong một batch; trả về danh sách sách không khớp để báo lỗi rõ ràng
  async function stockRefs(items) {
    const refs = await Promise.all(items.map(resolveBookRef));
    return { refs, missing: items.filter((_, i) => !refs[i]).map((b) => b.ten_sach) };
  }

  // Cấp hộc trống + chạy build(tx, tenHoc, snaps) trong CÙNG một transaction (chống 2 người trùng hộc)
  async function allocate({ state, token, reads = [], build }) {
    const snap = await db.collection("lockers").get();
    const byName = {};
    snap.forEach((d) => { byName[d.data().so_hoc || d.id] = d; });
    const cand = [];
    for (let i = 1; i <= 20; i++) {
      const name = lockerName(i);
      if (!byName[name] || byName[name].data().trang_thai === "trong") cand.push({ name, ref: byName[name] ? byName[name].ref : lockerRef(name) });
    }
    return db.runTransaction(async (tx) => {
      const rs = await Promise.all(reads.map((r) => tx.get(r)));
      let ch = null;
      for (const c of cand) { const s = await tx.get(c.ref); if (!s.exists || s.data().trang_thai === "trong") { ch = c; break; } }
      if (!ch) throw new Error("Toàn bộ 20 hộc tủ đều đang bận!");
      tx.set(ch.ref, { so_hoc: ch.name, trang_thai: state, qr_token: token, cap_nhat_luc: FV.serverTimestamp() }, { merge: true });
      return build(tx, ch.name, rs);
    });
  }


  // ---- Popup thay cho alert()/confirm() của trình duyệt (xếp hàng, không chặn luồng chạy) ----
  const queue = [];
  let busy = false;
  const LOOK = { warn: { icon: "!", bg: "#fef3c7", fg: "#b45309" } };
  function showNext() {
    if (busy || !queue.length) return;
    busy = true;
    const { msg, ask, done } = queue.shift();
    const text = String(msg).replace(/^(🎉|⚠️|🔓|❌)\s*/, "");
    const k = LOOK.warn;
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit";
    ov.innerHTML =
      '<div role="dialog" aria-modal="true" style="background:#fff;color:#0f172a;width:100%;max-width:380px;border-radius:20px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.3);text-align:center">' +
      '<div style="width:48px;height:48px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;background:' + k.bg + ';color:' + k.fg + '">' + k.icon + '</div>' +
      '<div style="font-weight:800;font-size:16px;margin-bottom:6px">' + 'Xác nhận' + '</div>' +
      '<div class="dlg-msg" style="font-size:14px;line-height:1.5;color:#475569;white-space:pre-line"></div>' +
      '<div style="display:flex;gap:8px;margin-top:20px"></div></div>';
    ov.querySelector(".dlg-msg").textContent = text;
    const row = ov.lastChild.lastChild;
    const close = (val) => { document.removeEventListener("keydown", onKey); ov.remove(); busy = false; done(val); showNext(); };
    const mk = (label, primary, val) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "flex:1;padding:10px 14px;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;border:0;" +
        (primary ? "background:#ea580c;color:#fff" : "background:#f1f5f9;color:#334155");
      b.onclick = () => close(val);
      row.appendChild(b);
      return b;
    };
    if (ask) mk("Hủy", false, false);
    const ok = mk(ask ? "Đồng ý" : "OK", true, true);
    const onKey = (e) => { if (e.key === "Escape") close(!ask); };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    ok.focus();
  }
  // alert() cũ -> Toast: tự nhận loại thông báo và tách tiêu đề / mô tả từ câu chữ
  const KINDS = [["error", /^(❌|Lỗi|Không thể)/], ["warning", /^(⚠️|Vui lòng|Toàn bộ|Đơn này|Mã |Sai|Không)/], ["success", /(thành công|🎉|🔓|^Đã )/]];
  function notify(msg) {
    const raw = String(msg).trim(), text = raw.replace(/^(🎉|⚠️|🔓|❌)\s*/u, "");
    if (typeof window.showToast !== "function") return console.log(text);
    let type = "info";
    for (const [t, re] of KINDS) if (re.test(raw)) { type = t; break; }
    const m = text.match(/^(.{3,80}?[!.])\s+([\s\S]+)$/);
    window.showToast({ type, title: m ? m[1].replace(/\.$/, "") : "", message: m ? m[2] : text });
  }
  function confirmBox(msg) { return new Promise((res) => { queue.push({ msg, ask: true, done: res }); showNext(); }); }
  window.alert = notify;

  window.App = { notify, confirm: confirmBox, auth, db, FV, PAGE, login, watchAuth, listen, stopAll, lockerName, lockerId, lockerRef, today, resolveBookRef, stockRefs, allocate };
})();