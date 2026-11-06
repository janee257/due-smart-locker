// Vercel Serverless: n8n (đã xác thực SePay) -> API này -> Firestore Admin.
// Set FIREBASE_SERVICE_ACCOUNT_JSON, N8N_SHARED_SECRET, SEPAY_RECEIVE_ACCOUNT in Vercel env.
const admin = require('firebase-admin');
const crypto = require('crypto');

function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({credential: admin.credential.cert(JSON.parse(raw))});
  }
  return admin.firestore();
}

function sameSecret(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({success:false});
  const expectedSecret = process.env.N8N_SHARED_SECRET;
  if (!sameSecret(req.headers.authorization, 'Bearer ' + expectedSecret) || !expectedSecret)
    return res.status(401).json({success:false});
  const account = process.env.SEPAY_RECEIVE_ACCOUNT;
  if (!account) return res.status(500).json({success:false, error:'Missing receive account'});
  const body = req.body || {};
  const sepayId = String(body.id || '');
  const content = String(body.content || '');
  const code = String(body.code || '').trim().toUpperCase();
  // Nếu SePay chưa cấu hình tách code, nhận diện mã trong nội dung CK.
  const match = content.toUpperCase().match(/(?:^|[^A-Z0-9])(DUE[PF][A-Z0-9]{20})(?![A-Z0-9])/);
  const paymentCode = /^DUE[PF][A-Z0-9]{20}$/.test(code) ? code : (match ? match[1] : '');
  if (!/^\d+$/.test(sepayId) || !paymentCode || body.transferType !== 'in' ||
      String(body.accountNumber) !== String(account) ||
      !Number.isSafeInteger(Number(body.transferAmount)) || Number(body.transferAmount) <= 0)
    return res.status(200).json({success:true, matched:false});
  try {
    const db = getDb();
    const isCompensation = paymentCode.startsWith('DUEF');
    const matches = await db.collection(isCompensation ? 'penalties' : 'returns').where('payment_code','==',paymentCode).limit(2).get();
    if (matches.size !== 1) return res.status(200).json({success:true, matched:false});
    const docRef = matches.docs[0].ref;
    const eventRef = db.collection('sepay_events').doc(sepayId);
    const amount = Number(body.transferAmount);
    const result = await db.runTransaction(async (tx) => {
      const [event, order] = await Promise.all([tx.get(eventRef),tx.get(docRef)]);
      if (event.exists) return 'duplicate';
      const r = order.data();
      if (!r || (!isCompensation && !['cho_bo_sach','cho_tra_tai_kiosk'].includes(r.trang_thai)) ||
          r.payment_code !== paymentCode || r.payment_status !== 'pending' ||
          Number(r.payment_amount) !== amount) return 'unmatched';
      tx.create(eventRef, {
        payment_code:paymentCode, [isCompensation ? 'penalty_id' : 'return_id']:docRef.id, amount,
        account_number:String(body.accountNumber), received_at:admin.firestore.FieldValue.serverTimestamp()
      });
      tx.update(docRef, {
        payment_status:'paid', paid_amount:amount, payment_txn_id:sepayId,
        paid_at:admin.firestore.FieldValue.serverTimestamp()
      });
      return 'paid';
    });
    return res.status(200).json({success:true, result});
  } catch(e) {
    console.error('Payment reconciliation error:', e);
    return res.status(500).json({success:false});
  }
};
