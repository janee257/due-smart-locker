import firebase_admin
from firebase_admin import credentials, auth
import getpass
import os

# 1. Khởi tạo Firebase Admin SDK bằng file khóa bí mật
KEY_PATH = "serviceAccountKey.json"

if not os.path.exists(KEY_PATH):
    print(f"\n[!] LỖI: Không tìm thấy file '{KEY_PATH}' trong thư mục dự án!")
    print("Vui lòng tải file khóa từ Firebase Console và lưu đúng tên 'serviceAccountKey.json' trước khi chạy tiếp.")
    exit(1)

cred = credentials.Certificate(KEY_PATH)
firebase_admin.initialize_app(cred)

# 2. Danh sách 5 sinh viên DUE chuẩn
students = [
    {"email": "251121514110@due.udn.vn", "password": "123456", "display_name": "Phạm Nhật Hạ", "mssv": "251121514110"},
    {"email": "241121521143@due.udn.vn", "password": "123456", "display_name": "Nguyễn Thị Phương Thảo", "mssv": "241121521143"},
    {"email": "241121521153@due.udn.vn", "password": "123456", "display_name": "Trần Thị Thu Uyên", "mssv": "241121521153"},
    {"email": "241121521136@due.udn.vn", "password": "123456", "display_name": "Đặng Mai Phương", "mssv": "241121521136"},
    {"email": "241121521133@due.udn.vn", "password": "123456", "display_name": "Hoàng Ngọc Phương Nhi", "mssv": "241121521133"},
]

print("\n--- BẮT ĐẦU TẠO TÀI KHOẢN FIREBASE CHO HỆ THỐNG DUE SMART LOCKER ---")

# Tạo tài khoản sinh viên
for s in students:
    try:
        user = auth.create_user(
            email=s["email"],
            password=s["password"],
            display_name=s["display_name"],
            uid=s["mssv"]
        )
        # Gán role sinh_vien vào Custom Claims
        auth.set_custom_user_claims(user.uid, {"role": "sinh_vien", "mssv": s["mssv"]})
        print(f"[✓] Đã tạo sinh viên: {s['display_name']} ({s['email']})")
    except auth.EmailAlreadyExistsError:
        user = auth.get_user_by_email(s["email"])
        auth.set_custom_user_claims(user.uid, {"role": "sinh_vien", "mssv": s["mssv"]})
        print(f"[-] Sinh viên đã tồn tại, cập nhật role: {s['display_name']}")
    except Exception as e:
        print(f"[x] Lỗi tạo tài khoản {s['email']}: {e}")

# Nhập mật khẩu tạo tài khoản Thủ thư
print("\n--- THIẾT LẬP TÀI KHOẢN THỦ THƯ ---")
librarian_email = "thuthu@due.udn.vn"
while True:
    lib_pwd = input("Nhập mật khẩu cho Thủ thư (tối thiểu 8 ký tự): ").strip()
    if len(lib_pwd) >= 8:
        break
    print("Mật khẩu quá ngắn, vui lòng nhập lại!")

try:
    user = auth.create_user(
        email=librarian_email,
        password=lib_pwd,
        display_name="Thủ thư Thư viện DUE",
        uid="THUTHU01"
    )
    auth.set_custom_user_claims(user.uid, {"role": "thu_thu"})
    print(f"[✓] Đã tạo tài khoản Thủ thư thành công ({librarian_email})")
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email(librarian_email)
    auth.update_user(user.uid, password=lib_pwd)
    auth.set_custom_user_claims(user.uid, {"role": "thu_thu"})
    print(f"[✓] Đã cập nhật mật khẩu và role cho Thủ thư ({librarian_email})")
except Exception as e:
    print(f"[x] Lỗi tạo Thủ thư: {e}")

# Nhập mật khẩu tạo tài khoản Kiosk
print("\n--- THIẾT LẬP TÀI KHOẢN TRẠM KIOSK ---")
kiosk_email = "kiosk@due.udn.vn"
while True:
    kiosk_pwd = input("Nhập mật khẩu cho Kiosk (tối thiểu 8 ký tự): ").strip()
    if len(kiosk_pwd) >= 8:
        break
    print("Mật khẩu quá ngắn, vui lòng nhập lại!")

try:
    user = auth.create_user(
        email=kiosk_email,
        password=kiosk_pwd,
        display_name="Trạm Kiosk Locker DUE",
        uid="KIOSK01"
    )
    auth.set_custom_user_claims(user.uid, {"role": "kiosk"})
    print(f"[✓] Đã tạo tài khoản Kiosk thành công ({kiosk_email})")
except auth.EmailAlreadyExistsError:
    user = auth.get_user_by_email(kiosk_email)
    auth.update_user(user.uid, password=kiosk_pwd)
    auth.set_custom_user_claims(user.uid, {"role": "kiosk"})
    print(f"[✓] Đã cập nhật mật khẩu và role cho Kiosk ({kiosk_email})")
except Exception as e:
    print(f"[x] Lỗi tạo Kiosk: {e}")

print("\n🎉 HOÀN TẤT SEED DỮ LIỆU TÀI KHOẢN LÊN FIREBASE AUTHENTICATION!\n")