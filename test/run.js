'use strict';
// DUE Smart Locker: automated offline API regression tests.
// No Firebase credentials, real money, database writes or external emails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const SUCCESS_CODE_P = 'DUEP' + 'A'.repeat(20);
const SUCCESS_CODE_F = 'DUEF' + 'B'.repeat(20);

function envValues() {
  return {
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({project_id: 'offline-test'}),
    N8N_SHARED_SECRET: 'offline-secret',
    SEPAY_RECEIVE_ACCOUNT: 'TEST_ACCOUNT',
    RESEND_API_KEY: 'offline-test-key',
    PENALTY_MAIL_FROM: 'Demo <onboarding@resend.dev>',
    PENALTY_EMAIL_TEST_MODE: 'true',
    PENALTY_TEST_EMAIL: 'test@example.com'
  };
}

function fixture() {
  const collections = {
    returns: {return001: {payment_code: SUCCESS_CODE_P, payment_status: 'pending', payment_amount: 5000, trang_thai: 'cho_bo_sach'}},
    penalties: {penalty001: {payment_code: SUCCESS_CODE_F, payment_status: 'pending', payment_amount: 30000, so_tien_phat: 30000, mssv: '251121514110', ten_sach: 'Sách kiểm thử', ma_vach: 'BK-01', ly_do: 'Rách trang'}},
    sepay_events: {}
  };
  const writes = [];
  const ref = (coll, id) => ({coll, id, async get() {return {exists: !!collections[coll]?.[id], data: () => collections[coll][id]};}, async update(data) {Object.assign(collections[coll][id],data); writes.push({type:'update',coll,id});}});
  const db = {
    collection(coll) {
      return {
        doc(id) {return ref(coll,id);},
        where(field, op, value) {
          assert.equal(op, '==');
          return {limit(n) {return {async get() {const ids = Object.keys(collections[coll]||{}).filter(id => collections[coll][id][field] === value).slice(0,n); return {size:ids.length,docs:ids.map(id=>({ref:ref(coll,id)}))};}};}};
        }
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(r) {return {exists: !!collections[r.coll]?.[r.id], data: () => collections[r.coll]?.[r.id]};},
        create(r, data) {assert.equal(collections[r.coll][r.id],undefined); collections[r.coll][r.id] = {...data}; writes.push({type:'create',coll:r.coll,id:r.id});},
        update(r,data) {Object.assign(collections[r.coll][r.id],data); writes.push({type:'update',coll:r.coll,id:r.id});}
      };
      return fn(tx);
    }
  };
  const admin = {
    apps: [],
    credential: {cert: () => ({})},
    initializeApp() {admin.apps.push({});},
    firestore: Object.assign(() => db,{FieldValue:{serverTimestamp:()=> 'TIMESTAMP'}}),
    auth: () => ({verifyIdToken: async(token) => {
      if (token === 'librarian') return {email:'thuthu@due.udn.vn',email_verified:true};
      if (token === 'student') return {email:'student@due.udn.vn',email_verified:true};
      throw Error('Invalid token');
    }})
  };
  return {collections,writes,admin};
}

function loadApi(filename, fixtureData, environment, fetchMock) {
  const filenameAbs = path.join(root,'api',filename);
  if (!fs.existsSync(filenameAbs)) throw new Error('Không tìm thấy file API: '+filenameAbs);
  const source = fs.readFileSync(filenameAbs,'utf8');
  const sandbox = {
    module:{exports:{}}, exports:{},
    require:(name)=> {
      if(name==='firebase-admin') return fixtureData.admin;
      if(name==='crypto') return crypto;
      throw Error('Unexpected dependency: '+name);
    },
    process:{env:environment}, Buffer, console,
    fetch: fetchMock || (()=>{throw Error('External network must not be called in offline tests')})
  };
  vm.runInNewContext(source,sandbox,{filename:filenameAbs, timeout:2500});
  return sandbox.module.exports;
}

async function invoke(handler,{method='POST',token='Bearer offline-secret',body={}}={}) {
  const response = {statusCode:200, payload:undefined,
    status(n) {this.statusCode=n;return this;},
    json(v) {this.payload=JSON.parse(JSON.stringify(v));return this;}
  };
  await handler({method,headers:{authorization:token},body},response);
  return response;
}

const paymentBody = (code,amount,id='123') => ({
  id, content:'Thanh toan '+code, transferType:'in', accountNumber:'TEST_ACCOUNT', transferAmount:amount
});

test('PAY01 - Từ chối phương thức khác POST',async()=>{
  const f=fixture();const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{method:'GET'});
  assert.equal(r.statusCode,405);assert.equal(f.writes.length,0);
});
test('PAY02 - Không có secret hợp lệ thì trả 401',async()=>{
  const f=fixture();const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{token:'Bearer incorrect',body:paymentBody(SUCCESS_CODE_P,5000)});
  assert.equal(r.statusCode,401);assert.equal(f.writes.length,0);
});
test('PAY03 - Mã giao dịch không khớp thì không ghi thanh toán',async()=>{
  const f=fixture();const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{body:paymentBody('DUEP'+'Z'.repeat(20),5000)});
  assert.equal(r.statusCode,200);assert.equal(r.payload.matched,false);assert.equal(f.writes.length,0);
});
test('PAY04 - Từ chối tài khoản nhận không đúng',async()=>{
  const f=fixture();const b=paymentBody(SUCCESS_CODE_P,5000);b.accountNumber='WRONG';const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{body:b});
  assert.equal(r.payload.matched,false);assert.equal(f.writes.length,0);
});
test('PAY05 - Chuyển tiền ra không được xem là khoản thu',async()=>{
  const f=fixture();const b=paymentBody(SUCCESS_CODE_P,5000);b.transferType='out';const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{body:b});
  assert.equal(r.payload.matched,false);assert.equal(f.writes.length,0);
});
test('PAY06 - Số tiền không khớp thì không cập nhật paid',async()=>{
  const f=fixture();const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{body:paymentBody(SUCCESS_CODE_P,4000)});
  assert.equal(r.payload.result,'unmatched');assert.equal(f.collections.returns.return001.payment_status,'pending');assert.equal(f.writes.length,0);
});
test('PAY07 - DUEP hợp lệ ghi nhận khoản phạt quá hạn',async()=>{
  const f=fixture();const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{body:paymentBody(SUCCESS_CODE_P,5000)});
  assert.equal(r.payload.result,'paid');assert.equal(f.collections.returns.return001.payment_status,'paid');
  assert.equal(f.collections.returns.return001.payment_txn_id,'123');assert.equal(f.writes.length,2);
});
test('PAY08 - DUEF hợp lệ ghi nhận bồi thường hư hỏng',async()=>{
  const f=fixture();const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{body:paymentBody(SUCCESS_CODE_F,30000)});
  assert.equal(r.payload.result,'paid');assert.equal(f.collections.penalties.penalty001.payment_status,'paid');
  assert.equal(f.collections.sepay_events['123'].penalty_id,'penalty001');
});
test('PAY09 - Gửi lại cùng một giao dịch không ghi đúp',async()=>{
  const f=fixture();const handler=loadApi('sepay-payment.js',f,envValues());const b=paymentBody(SUCCESS_CODE_P,5000);
  assert.equal((await invoke(handler,{body:b})).payload.result,'paid');
  const count=f.writes.length;
  assert.equal((await invoke(handler,{body:b})).payload.result,'duplicate');assert.equal(f.writes.length,count);
});
test('PAY10 - Không tìm thấy mã trong nội dung chuyển khoản thì bỏ qua',async()=>{
  const f=fixture();const b=paymentBody(SUCCESS_CODE_P,5000);b.content='chuyen khoan khong co ma';
  const r=await invoke(loadApi('sepay-payment.js',f,envValues()),{body:b});
  assert.equal(r.payload.matched,false);assert.equal(f.writes.length,0);
});
test('PAY11 - Không nhận thanh toán đã hoàn tất dưới ID mới',async()=>{
  const f=fixture();const handler=loadApi('sepay-payment.js',f,envValues());
  await invoke(handler,{body:paymentBody(SUCCESS_CODE_P,5000,'123')});
  const r=await invoke(handler,{body:paymentBody(SUCCESS_CODE_P,5000,'124')});
  assert.equal(r.payload.result,'unmatched');assert.equal(f.collections.sepay_events['124'],undefined);
});
test('MAIL01 - API email chỉ nhận POST',async()=>{
  const f=fixture();const r=await invoke(loadApi('notify-penalty.js',f,envValues()),{method:'GET'});
  assert.equal(r.statusCode,405);assert.equal(f.writes.length,0);
});
test('MAIL02 - Token sinh viên không thể gửi biên bản',async()=>{
  const f=fixture();const r=await invoke(loadApi('notify-penalty.js',f,envValues()),{token:'Bearer student',body:{penaltyId:'penalty001'}});
  assert.equal(r.statusCode,403);assert.equal(f.writes.length,0);
});
test('MAIL03 - Mã biên bản không hợp lệ bị từ chối',async()=>{
  const f=fixture();const r=await invoke(loadApi('notify-penalty.js',f,envValues()),{token:'Bearer librarian',body:{penaltyId:'../etc/passwd'}});
  assert.equal(r.statusCode,400);assert.equal(f.writes.length,0);
});
test('MAIL04 - Gửi email thử tới địa chỉ cố định, không theo client',async()=>{
  const f=fixture();const id='q'.repeat(20); f.collections.penalties[id]={...f.collections.penalties.penalty001};
  let called=0;const fetchMock=async(url,opts)=>{called++;assert.equal(url,'https://api.resend.com/emails');const payload=JSON.parse(opts.body);assert.deepEqual([...payload.to],['test@example.com']);assert.match(payload.html,/Sách kiểm thử/);return {ok:true,json:async()=>({id:'resend_fake_id'})};};
  const h=loadApi('notify-penalty.js',f,envValues(),fetchMock);
  const r=await invoke(h,{token:'Bearer librarian',body:{penaltyId:id,to:'attacker@example.com'}});
  assert.equal(r.statusCode,200);assert.equal(called,1);assert.equal(f.collections.penalties[id].email_status,'test_sent');
});
test('MAIL05 - Biên bản đã gửi không bị gửi lại',async()=>{
  const f=fixture();const id='q'.repeat(20);f.collections.penalties[id]={...f.collections.penalties.penalty001,email_status:'test_sent'};
  const handler=loadApi('notify-penalty.js',f,envValues());
  const r=await invoke(handler,{token:'Bearer librarian',body:{penaltyId:id}});
  assert.equal(r.payload.already_sent,true);assert.equal(f.writes.length,0);
});
