"""Nạp dữ liệu ban đầu vào Firestore (bản Python, cùng dữ liệu với scripts/seed.js).

Phần tài khoản đăng nhập (Firebase Auth) đã có script seed_firebase_users.py của bạn lo.
Script này chỉ tạo dữ liệu Firestore: users, books, lockers, counters, meta/sync.
Chạy được nhiều lần: tài liệu nào đã có thì giữ nguyên, không ghi đè.

Cách chạy (trong terminal của VS Code, cùng thư mục có serviceAccountKey.json):
    python scripts/seed_firestore.py
"""
import os
import sys
import time

import firebase_admin
from firebase_admin import credentials, firestore

KEY_PATH = os.getenv("FIREBASE_KEY", "serviceAccountKey.json")

# (MSSV, họ tên, email, vai trò): id lần lượt 1, 2, 3... theo thứ tự STAFF rồi STUDENTS
STAFF = [
    ["THUTHU01", "Thủ thư Thư viện DUE", "thuthu@due.udn.vn", "thu_thu"],
]
STUDENTS = [
    ["251121514110", "Phạm Nhật Hạ"],
    ["241121521143", "Nguyễn Thị Phương Thảo"],
    ["241121521153", "Trần Thị Thu Uyên"],
    ["241121521136", "Đặng Mai Phương"],
    ["241121521133", "Hoàng Ngọc Phương Nhi"],
]  # (MSSV, họ tên)
# (mã vạch, tên sách, tác giả, vị trí kệ, giá bìa): id lần lượt 1, 2, 3...
BOOKS = [
    ["DUE-MIS-001", "Quản lý Quy trình Kinh doanh (MIS3047)", "Bộ môn HTTT", "Tầng 2 - Kệ A1", 150000],
    ["DUE-MIS-002", "Quản lý Quy trình Kinh doanh (MIS3047)", "Bộ môn HTTT", "Tầng 2 - Kệ A1", 150000],
    ["DUE-MIS-003", "Quản trị Cơ sở Dữ liệu", "Bộ môn HTTT", "Tầng 2 - Kệ A2", 140000],
    ["DUE-MIS-004", "Quản trị Cơ sở Dữ liệu", "Bộ môn HTTT", "Tầng 2 - Kệ A2", 140000],
    ["DUE-ECO-001", "Kinh tế lượng ứng dụng", "Khoa Kinh tế", "Tầng 2 - Kệ B3", 135000],
    ["DUE-ACC-001", "Nguyên lý Kế toán", "Khoa Kế toán", "Tầng 3 - Kệ C2", 95000],
    ["DUE-ACC-002", "Kế toán Tài chính 1", "Khoa Kế toán", "Tầng 3 - Kệ C3", 115000],
    ["DUE-MAR-001", "Marketing Căn bản", "Khoa Marketing", "Tầng 3 - Kệ D1", 110000],
    ["DUE-MAR-002", "Hành vi Người tiêu dùng", "Khoa Marketing", "Tầng 3 - Kệ D2", 120000],
    ["DUE-FIN-001", "Tài chính Doanh nghiệp", "Khoa Tài chính", "Tầng 1 - Kệ F2", 125000],
    ["DUE-FIN-002", "Nghiệp vụ Ngân hàng Thương mại", "Khoa Ngân hàng", "Tầng 1 - Kệ F3", 130000],
    ["DUE-ECOM-001", "Thương mại Điện tử Căn bản", "Khoa TMĐT", "Tầng 2 - Kệ E1", 118000],
    ["DUE-LAW-001", "Pháp luật Đại cương & Luật Kinh tế", "Khoa Luật", "Tầng 3 - Kệ L1", 99000],
    ["DUE-STA-001", "Nguyên lý Thống kê Kinh tế", "Khoa Thống kê - Tin học", "Tầng 2 - Kệ S1", 105000],
    ["DUE-IT-001", "Lập trình Python phân tích dữ liệu", "Bộ môn Tin học Quản lý", "Tầng 2 - Kệ A3", 160000],
]


def create_if_missing(ref, data):
    if ref.get().exists:
        return False
    ref.set(data)
    return True


def main():
    if not os.path.exists(KEY_PATH):
        sys.exit(f"Không tìm thấy '{KEY_PATH}'. Hãy đặt file khóa (khóa MỚI) vào thư mục chạy lệnh.")
    firebase_admin.initialize_app(credentials.Certificate(KEY_PATH))
    db = firestore.client()

    users = [
        {"mssv": m, "ho_ten": n, "email": e, "vai_tro": r} for m, n, e, r in STAFF
    ] + [
        {"mssv": m, "ho_ten": n, "email": f"{m}@due.udn.vn", "vai_tro": "sinh_vien"} for m, n in STUDENTS
    ]
    try:
        added = 0
        for i, u in enumerate(users, start=1):
            added += create_if_missing(db.collection("users").document(u["mssv"]), {**u, "id": i, "tien_no_phat": 0})
        print(f"users:   thêm {added}/{len(users)}")

        added = 0
        for i, (ma_vach, ten_sach, tac_gia, vi_tri_ke, gia_bia) in enumerate(BOOKS, start=1):
            added += create_if_missing(db.collection("books").document(str(i)), {
                "id": i, "ma_vach": ma_vach, "ten_sach": ten_sach, "tac_gia": tac_gia,
                "vi_tri_ke": vi_tri_ke, "gia_bia": gia_bia, "trang_thai": "co_san",
            })
        print(f"books:   thêm {added}/{len(BOOKS)}")

        added = 0
        for i in range(1, 21):
            added += create_if_missing(db.collection("lockers").document(str(i)), {
                "id": i, "so_hoc": f"Hộc {i:02d}", "trang_thai": "trong",
                "reservation_id": None, "token": None, "hold_until": None,
            })
        print(f"lockers: thêm {added}/20")

        create_if_missing(db.document("counters/books"), {"next": len(BOOKS) + 1})
        create_if_missing(db.document("counters/reservations"), {"next": 1})
        db.document("meta/sync").set({"rev": time.time() * 1000})
    except Exception as e:  # noqa: BLE001
        if "does not exist" in str(e) or "NOT_FOUND" in str(e) or e.__class__.__name__ == "NotFound":
            sys.exit("Firestore chưa được tạo. Vào Firebase Console > Firestore Database > Create database, rồi chạy lại.")
        raise
    print("Xong. Dữ liệu Firestore đã sẵn sàng.")


if __name__ == "__main__":
    main()
