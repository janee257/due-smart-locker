// API gửi biên bản sau nghiệm thu: chỉ thủ thư có Firebase ID token hợp lệ mới gọi được.
// Thiết lập FIREBASE_SERVICE_ACCOUNT_JSON, RESEND_API_KEY, PENALTY_MAIL_FROM trên Vercel.
const admin = require('firebase-admin');
function getFirebase() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}
function htmlEscape(x) {
  return String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
module.exports = async (req,res) => {
  if (req.method !== 'POST') return res.status(405).json({success:false});
  try {
    const bearer = String(req.headers.authorization || '');
    if (!bearer.startsWith('Bearer ')) return res.status(401).json({success:false});
    const firebase = getFirebase();
    const decoded = await firebase.auth().verifyIdToken(bearer.slice(7));
    const email = String(decoded.email || '').toLowerCase();
    if (!decoded.email_verified && !email.endsWith('@due.udn.vn')) return res.status(403).json({success:false});
    if (!email.split('@')[0].includes('thuthu')) return res.status(403).json({success:false});
    const penaltyId = String(req.body?.penaltyId || '');
    if (!/^[a-zA-Z0-9]{20}$/.test(penaltyId)) return res.status(400).json({success:false,error:'Mã biên bản không hợp lệ.'});
    const apiKey = process.env.RESEND_API_KEY, from = process.env.PENALTY_MAIL_FROM;
    if (!apiKey || !from) return res.status(503).json({success:false,error:'Chưa cấu hình dịch vụ email trên Vercel.'});
    const db = firebase.firestore(), ref = db.collection('penalties').doc(penaltyId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({success:false,error:'Không tìm thấy biên bản.'});
    const p = snap.data();
    if (p.email_status === 'sent' || p.email_status === 'test_sent') return res.status(200).json({success:true,already_sent:true});
    const mssv = String(p.mssv || '');
    if (!/^\d{8,15}$/.test(mssv)) return res.status(400).json({success:false,error:'MSSV không hợp lệ.'});
    // TEST MODE: Chỉ gửi đến hộp thư kiểm thử do quản trị viên đặt ở Vercel.
    // Không nhận địa chỉ người nhận từ trình duyệt, tránh gửi tùy ý.
    const testMode = process.env.PENALTY_EMAIL_TEST_MODE === 'true';
    let to;
    if (testMode) {
      to = String(process.env.PENALTY_TEST_EMAIL || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(503).json({success:false,error:'Chưa cấu hình PENALTY_TEST_EMAIL hợp lệ.'});
      }
    } else {
      // Production: Chỉ gửi tới địa chỉ đăng ký trong Firebase Auth.
      const user = await firebase.auth().getUserByEmail(`${mssv}@due.udn.vn`);
      to = user.email;
    }
    const amount = Number(p.so_tien_phat || 0).toLocaleString('vi-VN');
    const description = `${p.ly_do || 'Bồi thường tài liệu'} (${p.ten_sach || 'Tài liệu'})`;
    const payload = {
      from, to: [to], subject: `${testMode ? '[THỬ NGHIỆM - KHÔNG GỬI SINH VIÊN] ' : ''}[DUE Smart Locker] Biên bản bồi thường ${penaltyId}`,
      html: `<p>Kính gửi sinh viên ${htmlEscape(mssv)},</p><p>Thủ thư đã nghiệm thu tài liệu bạn trả tại DUE Smart Locker và lập biên bản:</p><ul><li>Mã biên bản: <b>${htmlEscape(penaltyId)}</b></li><li>Nội dung: ${htmlEscape(description)}</li><li>Số tiền: <b>${amount} VNĐ</b></li></ul><p>Bạn vui lòng đăng nhập DUE Smart Locker, vào mục <b>Nợ phạt & Thông báo</b> để xem biên bản và thanh toán bằng VietQR. Không chuyển khoản lần nữa nếu trạng thái đã là Đã thanh toán.</p><p>Thư viện DUE Smart Locker</p>`
    };
    // Idempotency key giữ nguyên để các lần nhấn lại không vô tình gửi nhiều email cùng sự kiện.
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST', headers: {'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json', 'Idempotency-Key':`due-penalty-${penaltyId}`},
      body:JSON.stringify(payload)
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Mail provider returned',response.status, JSON.stringify(out).slice(0,400));
      await ref.update({email_status:'failed',email_last_attempt_at:firebase.firestore.FieldValue.serverTimestamp()});
      return res.status(502).json({success:false,error:'Nhà cung cấp email từ chối yêu cầu. Kiểm tra domain gửi và Resend Logs.'});
    }
    await ref.update({
      email_status: testMode ? 'test_sent' : 'sent',
      email_to:to,
      email_test_mode:testMode,
      email_provider_id:String(out.id || ''),
      email_sent_at:firebase.firestore.FieldValue.serverTimestamp()
    });
    return res.status(200).json({success:true,test_mode:testMode});
  } catch(e) {
    console.error('Penalty email error:',e.message);
    return res.status(500).json({success:false,error:'Lỗi gửi email. Kiểm tra cấu hình hoặc tài khoản sinh viên.'});
  }
};
