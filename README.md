# DUE Smart Locker (Vercel + Firebase)

Giao diện tĩnh (`student.html`, `kiosk.html`, `librarian.html`) + **một hàm serverless** `api/[...path].js`
xử lý toàn bộ `/api/*`. Dữ liệu ở **Firestore**, đăng nhập bằng **Firebase Auth** (role nằm trong custom claim).

```
student.html  kiosk.html  librarian.html  firebase-init.js   <- trang web (đăng nhập, gắn token, đồng bộ)
api/[...path].js                                              <- điểm vào duy nhất của API
lib/service.js   lib/router.js   lib/firebase.js              <- nghiệp vụ, phân quyền, khởi tạo Firebase
firestore.rules                                               <- chặn client đọc/ghi trực tiếp Firestore
scripts/seed.js                                               <- tạo tài khoản + dữ liệu ban đầu
test/                                                         <- 47 test nghiệp vụ + 19 test giao diện
```

## Triển khai (làm đúng thứ tự)

### 1. Firebase Console (project `due-smart-locker`)
1. **Authentication > Sign-in method**: bật *Email/Password*. Nếu có mục *Settings > User actions*, tắt "Enable create (sign-up)" để không ai tự tạo tài khoản.
2. **Firestore Database**: tạo database (nên chọn vùng gần Việt Nam, ví dụ `asia-southeast1`).
3. **Firestore > Rules**: dán toàn bộ `firestore.rules` rồi **Publish**. Bước này bắt buộc: nếu Rules vẫn ở "test mode" thì ai cũng đọc/ghi được dữ liệu.
4. **Project settings > Service accounts > Generate new private key**. Giữ file JSON này bí mật, không đưa lên Git.

### 2. Khởi tạo dữ liệu (chạy trên máy bạn, một lần)
```bash
npm install
export FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccountKey.json)"
export LIBRARIAN_PASSWORD='mật-khẩu-mới-≥8-ký-tự'
export KIOSK_PASSWORD='mật-khẩu-khác-≥8-ký-tự'
export STUDENT_DEFAULT_PW='mật-khẩu-khởi-tạo-sinh-viên'   # bỏ qua = 123456 (chỉ demo)
export RESET_STAFF_PASSWORDS=1    # đặt lại mật khẩu thủ thư/kiosk đã tồn tại (dùng để đổi mật khẩu đã lộ)
npm run seed          # hoặc: python scripts/seed_firestore.py (chỉ nạp dữ liệu Firestore)
```

### 3. Vercel
1. **Xóa khỏi repo**: `app.py`, `library.db`, `requirements.txt` (nếu có), để Vercel không nhận nhầm là dự án Python.
2. Chép các file của gói này vào gốc repo (ghi đè `student.html`, `kiosk.html`, `librarian.html`, thay `firebase-init.js` cũ). Giữ nguyên `logo_due.png`.
3. **Settings > Environment Variables**: thêm `FIREBASE_SERVICE_ACCOUNT` = toàn bộ nội dung file JSON ở bước 1.4 (dán nguyên văn).
4. `vercel.json` đặt vùng chạy hàm là `sin1` (Singapore). Hãy đổi cho gần vùng Firestore của bạn, vì mỗi giao dịch có vài lượt gọi tới Firestore.
5. Push lên Git để Vercel triển khai lại.

### 4. Giới hạn API key (khuyến nghị)
Google Cloud Console > APIs & Services > Credentials > Browser key của project: *Application restrictions* = HTTP referrers, chỉ cho `https://due-smart-locker.vercel.app/*` (và `http://localhost:*` nếu cần chạy thử).

## Tài khoản
| Ai | Đăng nhập | Role |
|---|---|---|
| Sinh viên | `MSSV` hoặc `MSSV@due.udn.vn` | `sinh_vien` |
| Thủ thư | `thuthu@due.udn.vn` | `thu_thu` |
| Kiosk | `kiosk@due.udn.vn` | `kiosk` |

Quyền được kiểm tra **ở server** theo custom claim, không phải theo chữ trong email.

## Chạy kiểm thử
```bash
npm test                     # 47 test nghiệp vụ, phân quyền, transaction (không cần mạng)
npm i -D jsdom && npm run test:e2e    # 19 test nạp đúng 3 trang HTML với API thật (chỉ chạy trên máy bạn)
```

## Chi phí Firestore
Kiosk và thủ thư không còn polling 3 đến 5 giây. Họ nghe tài liệu `meta/sync` (1 lượt đọc mỗi thay đổi) rồi mới gọi API, kèm một lượt tải dự phòng mỗi 60 giây. Quy mô một thư viện nằm trong hạn mức miễn phí của gói Spark.
