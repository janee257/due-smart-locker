import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="DUE Smart Library Locker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_NAME = "library.db"

# ----------------- KHỞI TẠO CƠ SỞ DỮ LIỆU SQLITE -----------------
def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # Bảng Người dùng
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mssv TEXT UNIQUE,
            mat_khau TEXT DEFAULT '123456',
            ho_ten TEXT,
            email TEXT,
            vai_tro TEXT,
            tien_no_phat INTEGER DEFAULT 0
        )
    """)

    # Bảng Kho sách
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ma_vach TEXT UNIQUE,
            ten_sach TEXT,
            tac_gia TEXT,
            vi_tri_ke TEXT,
            trang_thai TEXT DEFAULT 'co_san',
            gia_bia INTEGER DEFAULT 120000
        )
    """)

    # Bảng 20 Hộc tủ Smart Locker
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lockers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            so_hoc TEXT UNIQUE,
            trang_thai TEXT DEFAULT 'trong',
            reservation_id INTEGER
        )
    """)

    # Bảng Đơn đặt hẹn & Mượn trả
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS borrow_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            book_id INTEGER,
            locker_id INTEGER,
            ngay_hen TEXT,
            khung_gio TEXT,
            qr_token TEXT,
            ngay_muon TEXT,
            han_tra TEXT,
            ngay_tra TEXT,
            tien_phat INTEGER DEFAULT 0,
            trang_thai_don TEXT
        )
    """)

    # Khởi tạo tài khoản Thủ thư (nếu chưa có)
    cursor.execute("SELECT COUNT(*) FROM users WHERE mssv = 'THUTHU01'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT INTO users (mssv, mat_khau, ho_ten, email, vai_tro, tien_no_phat) 
            VALUES ('THUTHU01', '123456', 'Thủ thư Thư viện DUE', 'thuthu@due.udn.vn', 'thu_thu', 0)
        """)

    # 5 Tài khoản sinh viên DUE chuẩn
    students_list = [
        ('251121514110', '123456', 'Phạm Nhật Hạ', '251121514110@due.udn.vn', 'sinh_vien', 0),
        ('241121521143', '123456', 'Nguyễn Thị Phương Thảo', '241121521143@due.udn.vn', 'sinh_vien', 0),
        ('241121521153', '123456', 'Trần Thị Thu Uyên', '241121521153@due.udn.vn', 'sinh_vien', 0),
        ('241121521136', '123456', 'Đặng Mai Phương', '241121521136@due.udn.vn', 'sinh_vien', 0),
        ('241121521133', '123456', 'Hoàng Ngọc Phương Nhi', '241121521133@due.udn.vn', 'sinh_vien', 0)
    ]
    for s in students_list:
        cursor.execute("SELECT COUNT(*) FROM users WHERE mssv = ?", (s[0],))
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO users (mssv, mat_khau, ho_ten, email, vai_tro, tien_no_phat) 
                VALUES (?, ?, ?, ?, ?, ?)
            """, s)

    # Nạp danh mục sách ban đầu
    initial_books = [
        ('DUE-MIS-001', 'Quản lý Quy trình Kinh doanh (MIS3047)', 'Bộ môn HTTT', 'Tầng 2 - Kệ A1', 'co_san', 150000),
        ('DUE-MIS-002', 'Quản lý Quy trình Kinh doanh (MIS3047)', 'Bộ môn HTTT', 'Tầng 2 - Kệ A1', 'co_san', 150000),
        ('DUE-MIS-003', 'Quản trị Cơ sở Dữ liệu', 'Bộ môn HTTT', 'Tầng 2 - Kệ A2', 'co_san', 140000),
        ('DUE-MIS-004', 'Quản trị Cơ sở Dữ liệu', 'Bộ môn HTTT', 'Tầng 2 - Kệ A2', 'co_san', 140000),
        ('DUE-ECO-001', 'Kinh tế lượng ứng dụng', 'Khoa Kinh tế', 'Tầng 2 - Kệ B3', 'co_san', 135000),
        ('DUE-ACC-001', 'Nguyên lý Kế toán', 'Khoa Kế toán', 'Tầng 3 - Kệ C2', 'co_san', 95000),
        ('DUE-ACC-002', 'Kế toán Tài chính 1', 'Khoa Kế toán', 'Tầng 3 - Kệ C3', 'co_san', 115000),
        ('DUE-MAR-001', 'Marketing Căn bản', 'Khoa Marketing', 'Tầng 3 - Kệ D1', 'co_san', 110000),
        ('DUE-MAR-002', 'Hành vi Người tiêu dùng', 'Khoa Marketing', 'Tầng 3 - Kệ D2', 'co_san', 120000),
        ('DUE-FIN-001', 'Tài chính Doanh nghiệp', 'Khoa Tài chính', 'Tầng 1 - Kệ F2', 'co_san', 125000),
        ('DUE-FIN-002', 'Nghiệp vụ Ngân hàng Thương mại', 'Khoa Ngân hàng', 'Tầng 1 - Kệ F3', 'co_san', 130000),
        ('DUE-ECOM-001', 'Thương mại Điện tử Căn bản', 'Khoa TMĐT', 'Tầng 2 - Kệ E1', 'co_san', 118000),
        ('DUE-LAW-001', 'Pháp luật Đại cương & Luật Kinh tế', 'Khoa Luật', 'Tầng 3 - Kệ L1', 'co_san', 99000),
        ('DUE-STA-001', 'Nguyên lý Thống kê Kinh tế', 'Khoa Thống kê - Tin học', 'Tầng 2 - Kệ S1', 'co_san', 105000),
        ('DUE-IT-001', 'Lập trình Python phân tích dữ liệu', 'Bộ môn Tin học Quản lý', 'Tầng 2 - Kệ A3', 'co_san', 160000)
    ]
    for b in initial_books:
        cursor.execute("SELECT COUNT(*) FROM books WHERE ma_vach = ?", (b[0],))
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO books (ma_vach, ten_sach, tac_gia, vi_tri_ke, trang_thai, gia_bia)
                VALUES (?, ?, ?, ?, ?, ?)
            """, b)

    # Nạp 20 hộc tủ
    cursor.execute("SELECT COUNT(*) FROM lockers")
    if cursor.fetchone()[0] == 0:
        lockers_data = [(f"Hộc {i:02d}", 'trong', None) for i in range(1, 21)]
        cursor.executemany("INSERT INTO lockers (so_hoc, trang_thai, reservation_id) VALUES (?, ?, ?)", lockers_data)

    conn.commit()
    conn.close()

init_db()

# ----------------- SCHEMAS -----------------
class StudentLoginRequest(BaseModel):
    mssv: str
    password: str

class ChangePasswordRequest(BaseModel):
    user_id: int
    old_password: str
    new_password: str

class CartReserveRequest(BaseModel):
    user_id: int
    book_ids: List[int]
    ngay_hen: str
    khung_gio: str

class PickupRequest(BaseModel):
    qr_token: str

class ReturnRequest(BaseModel):
    ma_vach: str

class AddBookRequest(BaseModel):
    ma_vach: str
    ten_sach: str
    tac_gia: str
    vi_tri_ke: str
    so_luong: int = 1
    gia_bia: int = 120000

class EditBookRequest(BaseModel):
    old_title: str
    new_title: str
    tac_gia: str
    vi_tri_ke: str

class BatchReturnRequest(BaseModel):
    user_id: int
    reservation_ids: List[int]

class InspectReturnRequest(BaseModel):
    reservation_id: int
    tinh_trang: str  # "binh_thuong" hoặc "hu_hong"
    tien_phat_them: int = 0
    ghi_chu: str = ""
# ----------------- ĐIỀU HƯỚNG GIAO DIỆN -----------------
@app.get("/logo_due.png")
def get_logo():
    import os
    if os.path.exists("logo_due.png"):
        return FileResponse("logo_due.png")
    return FileResponse("logo_due.jpg") if os.path.exists("logo_due.jpg") else None
# Mặc định trang chủ và link public mở thẳng Cổng Sinh Viên
@app.get("/")
@app.get("/student")
def get_student_page():
    return FileResponse("student.html")

# Hai trang này chỉ bạn mở trên máy tính của mình
@app.get("/kiosk")
def get_kiosk_page():
    return FileResponse("kiosk.html")

@app.get("/librarian")
def get_librarian_page():
    return FileResponse("librarian.html")

# ----------------- API BACKEND -----------------

# Đăng nhập Sinh viên
@app.post("/api/student/login")
def student_login(req: StudentLoginRequest):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE mssv = ? AND vai_tro = 'sinh_vien'", (req.mssv.strip(),))
    user = cursor.fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="Mã số sinh viên không thuộc danh sách sinh viên trường DUE!")

    if req.password.strip() != user["mat_khau"]:
        raise HTTPException(status_code=401, detail="Mật khẩu không chính xác! (Mặc định: 123456)")

    return {
        "status": "success",
        "user": {
            "id": user["id"],
            "mssv": user["mssv"],
            "ho_ten": user["ho_ten"],
            "email": user["email"],
            "tien_no_phat": user["tien_no_phat"]
        }
    }

# Đổi mật khẩu
@app.post("/api/student/change-password")
def change_password(req: ChangePasswordRequest):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT mat_khau FROM users WHERE id = ?", (req.user_id,))
    u = cursor.fetchone()
    if not u or u["mat_khau"] != req.old_password.strip():
        conn.close()
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không chính xác!")
    
    cursor.execute("UPDATE users SET mat_khau = ? WHERE id = ?", (req.new_password.strip(), req.user_id))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Đổi mật khẩu thành công!"}

# Sách đang mượn
@app.get("/api/student/borrowed/{user_id}")
def get_borrowed_books(user_id: int):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.id as res_id, b.id as book_id, b.ten_sach, b.ma_vach, b.vi_tri_ke, 
               r.ngay_muon, r.han_tra, r.trang_thai_don
        FROM borrow_reservations r
        JOIN books b ON r.book_id = b.id
        WHERE r.user_id = ? AND r.trang_thai_don = 'dang_muon'
        ORDER BY r.id DESC
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# Lịch sử mượn trả
@app.get("/api/student/history/{user_id}")
def get_borrow_history(user_id: int):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.id, b.ten_sach, b.ma_vach, r.ngay_hen, r.ngay_muon, r.han_tra, r.ngay_tra, 
               r.tien_phat, r.trang_thai_don
        FROM borrow_reservations r
        JOIN books b ON r.book_id = b.id
        WHERE r.user_id = ?
        ORDER BY r.id DESC
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# ================== MỤC SỐ 2: BƯỚC 1 & 2 TRẢ NHIỀU SÁCH ==================
@app.post("/api/student/create-return-qr")
def create_batch_return_qr(req: BatchReturnRequest):
    if not req.reservation_ids:
        raise HTTPException(status_code=400, detail="Vui lòng tick chọn ít nhất 1 cuốn sách để trả!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # Kiểm tra xem có hộc tủ trống để nhận sách trả không
    cursor.execute("SELECT id, so_hoc FROM lockers WHERE trang_thai = 'trong' LIMIT 1")
    locker = cursor.fetchone()
    if not locker:
        conn.close()
        raise HTTPException(status_code=400, detail="Hiện tại tủ Smart Locker đã đầy, không còn hộc trống để nhận sách trả!")

    locker_id, so_hoc = locker[0], locker[1]
    qr_return_token = "TRA-" + str(uuid.uuid4())[:8].upper()

    # Gán cùng mã qr_return_token và locker_id cho toàn bộ sách được tick
    for res_id in req.reservation_ids:
        cursor.execute("""
            UPDATE borrow_reservations 
            SET qr_token = ?, locker_id = ?
            WHERE id = ? AND user_id = ? AND trang_thai_don = 'dang_muon'
        """, (qr_return_token, locker_id, res_id, req.user_id))

    conn.commit()
    conn.close()

    return {
        "status": "success",
        "qr_token": qr_return_token,
        "so_hoc": so_hoc,
        "count": len(req.reservation_ids),
        "message": f"Đã tạo mã QR trả cho {len(req.reservation_ids)} cuốn sách! Hộc nhận dự kiến: {so_hoc}."
    }
# API Lấy danh mục sách cho Sinh viên (Gom nhóm theo tên sách để không bị lặp thẻ)
@app.get("/api/books")
def get_books():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            MIN(id) as id,
            ten_sach,
            tac_gia,
            vi_tri_ke,
            MIN(ma_vach) as ma_vach,
            COUNT(*) as tong_so_luong,
            SUM(CASE WHEN trang_thai = 'co_san' THEN 1 ELSE 0 END) as so_luong_con,
            CASE WHEN SUM(CASE WHEN trang_thai = 'co_san' THEN 1 ELSE 0 END) > 0 THEN 'co_san' ELSE 'het_sach' END as trang_thai
        FROM books
        GROUP BY ten_sach
        ORDER BY ten_sach ASC
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# 1. API Đặt mượn giỏ hàng: CHỈ CẤP DUY NHẤT 1 HỘC TỦ CHO TOÀN BỘ SÁCH
@app.post("/api/reserve")
def reserve_cart(req: CartReserveRequest):
    if not req.book_ids:
        raise HTTPException(status_code=400, detail="Giỏ hàng chưa có sách nào!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # Kiểm tra nợ phạt
    cursor.execute("SELECT tien_no_phat FROM users WHERE id = ?", (req.user_id,))
    user = cursor.fetchone()
    if user and user[0] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Tài khoản đang nợ phạt, vui lòng thanh toán trước khi mượn!")

    # CẤP DUY NHẤT 1 HỘC TỦ TRỐNG CHO CẢ ĐƠN HÀNG
    cursor.execute("SELECT id, so_hoc FROM lockers WHERE trang_thai = 'trong' LIMIT 1")
    locker = cursor.fetchone()
    if not locker:
        conn.close()
        raise HTTPException(status_code=400, detail="Tất cả các hộc tủ Smart Locker hiện đã đầy!")

    locker_id, so_hoc = locker[0], locker[1]
    # DÙNG CHUNG 1 MÃ QR CHO TOÀN BỘ SÁCH TRONG ĐƠN
    qr_token = "QR-" + str(uuid.uuid4())[:8].upper()

    book_titles = []
    first_res_id = None

    for rep_id in req.book_ids:
        cursor.execute("SELECT ten_sach FROM books WHERE id = ?", (rep_id,))
        rep_bk = cursor.fetchone()
        if not rep_bk:
            conn.close()
            raise HTTPException(status_code=400, detail="Không tìm thấy thông tin giáo trình!")
        
        ten_sach = rep_bk[0]

        # Bốc 1 cuốn đang có sẵn thuộc đầu sách này
        cursor.execute("SELECT id FROM books WHERE ten_sach = ? AND trang_thai = 'co_san' LIMIT 1", (ten_sach,))
        actual_book = cursor.fetchone()
        if not actual_book:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Giáo trình '{ten_sach}' vừa hết hàng!")

        actual_book_id = actual_book[0]

        # Lưu đơn: tất cả cuốn sách đều có cùng locker_id và cùng qr_token
        cursor.execute("""
            INSERT INTO borrow_reservations (user_id, book_id, locker_id, ngay_hen, khung_gio, qr_token, trang_thai_don)
            VALUES (?, ?, ?, ?, ?, ?, 'cho_soan')
        """, (req.user_id, actual_book_id, locker_id, req.ngay_hen, req.khung_gio, qr_token))
        
        if first_res_id is None:
            first_res_id = cursor.lastrowid

        cursor.execute("UPDATE books SET trang_thai = 'da_dat_giu' WHERE id = ?", (actual_book_id,))
        book_titles.append(ten_sach)

    # Đánh dấu hộc tủ chuyển sang trạng thái chờ nhận
    cursor.execute("UPDATE lockers SET trang_thai = 'cho_nhan', reservation_id = ? WHERE id = ?", (first_res_id, locker_id))

    conn.commit()
    conn.close()

    return {
        "status": "success",
        "count": len(req.book_ids),
        "primary_qr": qr_token,
        "all_lockers": so_hoc,
        "book_titles": ", ".join(book_titles),
        "message": f"Đặt hẹn thành công {len(req.book_ids)} cuốn sách! Đã cấp duy nhất: {so_hoc}."
    }

# 1. API Lấy danh mục sách đã nhóm (Group by) theo Tên sách cho Thủ thư
@app.get("/api/librarian/books-grouped")
def get_grouped_books():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            ten_sach,
            tac_gia,
            vi_tri_ke,
            COUNT(*) as tong_so_luong,
            SUM(CASE WHEN trang_thai = 'co_san' THEN 1 ELSE 0 END) as so_luong_co_san,
            SUM(CASE WHEN trang_thai != 'co_san' THEN 1 ELSE 0 END) as so_luong_dang_muon,
            MIN(ma_vach) as ma_vach_dai_dien
        FROM books
        GROUP BY ten_sach
        ORDER BY ten_sach ASC
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# 2. API Bấm nút (+) Thêm 1 cuốn vào kho
@app.post("/api/librarian/book/increase")
def increase_book_stock(payload: dict):
    ten_sach = payload.get("ten_sach")
    if not ten_sach:
        raise HTTPException(status_code=400, detail="Thiếu tên sách!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT tac_gia, vi_tri_ke, gia_bia FROM books WHERE ten_sach = ? LIMIT 1", (ten_sach,))
    sample = cursor.fetchone()
    if not sample:
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy thông tin sách!")

    tac_gia, vi_tri_ke, gia_bia = sample[0], sample[1], sample[2]
    new_barcode = f"DUE-{str(uuid.uuid4())[:6].upper()}"

    cursor.execute("""
        INSERT INTO books (ma_vach, ten_sach, tac_gia, vi_tri_ke, gia_bia, trang_thai)
        VALUES (?, ?, ?, ?, ?, 'co_san')
    """, (new_barcode, ten_sach, tac_gia, vi_tri_ke, gia_bia))

    conn.commit()
    conn.close()
    return {"status": "success", "message": f"Đã thêm 1 cuốn '{ten_sach}' vào kho!"}

# 3. API Bấm nút (-) Bớt 1 cuốn (chỉ bớt cuốn đang 'co_san')
@app.post("/api/librarian/book/decrease")
def decrease_book_stock(payload: dict):
    ten_sach = payload.get("ten_sach")
    if not ten_sach:
        raise HTTPException(status_code=400, detail="Thiếu tên sách!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM books WHERE ten_sach = ? AND trang_thai = 'co_san' ORDER BY id DESC LIMIT 1", (ten_sach,))
    book = cursor.fetchone()
    if not book:
        conn.close()
        raise HTTPException(status_code=400, detail="Không thể giảm! Tất cả các cuốn của giáo trình này đều đang được giữ hoặc mượn.")

    book_id = book[0]
    cursor.execute("DELETE FROM books WHERE id = ?", (book_id,))
    conn.commit()
    conn.close()
    return {"status": "success", "message": f"Đã giảm 1 cuốn '{ten_sach}' khỏi kho!"}

# 4. API BẤM NÚT "LƯU" SỐ LƯỢNG MỚI ĐÃ NHẬP
@app.post("/api/librarian/book/set-stock")
def set_book_stock(payload: dict):
    ten_sach = payload.get("ten_sach")
    target_available = payload.get("so_luong")
    if ten_sach is None or target_available is None:
        raise HTTPException(status_code=400, detail="Thiếu thông tin cập nhật!")

    try:
        target_available = max(0, int(target_available))
    except ValueError:
        raise HTTPException(status_code=400, detail="Số lượng phải là số nguyên!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM books WHERE ten_sach = ? AND trang_thai = 'co_san'", (ten_sach,))
    current_avail_books = cursor.fetchall()
    current_count = len(current_avail_books)

    if target_available > current_count:
        cursor.execute("SELECT tac_gia, vi_tri_ke, gia_bia FROM books WHERE ten_sach = ? LIMIT 1", (ten_sach,))
        sample = cursor.fetchone()
        if not sample:
            conn.close()
            raise HTTPException(status_code=404, detail="Không tìm thấy sách!")
            
        tac_gia, vi_tri_ke, gia_bia = sample[0], sample[1], sample[2]
        diff = target_available - current_count
        for _ in range(diff):
            new_code = f"DUE-{str(uuid.uuid4())[:6].upper()}"
            cursor.execute("""
                INSERT INTO books (ma_vach, ten_sach, tac_gia, vi_tri_ke, gia_bia, trang_thai)
                VALUES (?, ?, ?, ?, ?, 'co_san')
            """, (new_code, ten_sach, tac_gia, vi_tri_ke, gia_bia))
    elif target_available < current_count:
        diff = current_count - target_available
        ids_to_delete = [b[0] for b in current_avail_books[:diff]]
        cursor.execute(f"DELETE FROM books WHERE id IN ({','.join(['?']*len(ids_to_delete))})", ids_to_delete)

    conn.commit()
    conn.close()
    return {"status": "success", "message": f"Đã lưu thành công số lượng '{ten_sach}': {target_available} cuốn có sẵn!"}

# 1. API Sửa thông tin giáo trình (Tên, Tác giả, Kệ)
@app.post("/api/librarian/book/edit")
def edit_book_info(req: EditBookRequest):
    old_title = req.old_title.strip()
    new_title = req.new_title.strip()
    tac_gia = req.tac_gia.strip()
    vi_tri_ke = req.vi_tri_ke.strip()

    if not old_title or not new_title:
        raise HTTPException(status_code=400, detail="Tên sách không được để trống!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE books 
        SET ten_sach = ?, tac_gia = ?, vi_tri_ke = ?
        WHERE ten_sach = ?
    """, (new_title, tac_gia, vi_tri_ke, old_title))

    conn.commit()
    conn.close()
    return {"status": "success", "message": f"Đã cập nhật thông tin thành công cho giáo trình '{new_title}'!"}

# 2. API Xóa toàn bộ đầu sách cũ khỏi kho
@app.post("/api/librarian/book/delete-group")
def delete_book_group(payload: dict):
    ten_sach = payload.get("ten_sach")
    if not ten_sach:
        raise HTTPException(status_code=400, detail="Thiếu tên sách cần xóa!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM books WHERE ten_sach = ? AND trang_thai != 'co_san'", (ten_sach,))
    busy_count = cursor.fetchone()[0]
    if busy_count > 0:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Không thể xóa! Hiện có {busy_count} cuốn của giáo trình này đang được sinh viên mượn hoặc giữ chỗ tại tủ.")

    cursor.execute("DELETE FROM books WHERE ten_sach = ?", (ten_sach,))
    conn.commit()
    conn.close()
    return {"status": "success", "message": f"Đã xóa toàn bộ giáo trình '{ten_sach}' khỏi hệ thống thư viện!"}
# 5. Thêm giáo trình mới kèm số lượng ban đầu
@app.post("/api/books")
def add_book(req: AddBookRequest):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    qty = max(1, req.so_luong)
    base_code = req.ma_vach.strip().upper()

    try:
        for i in range(qty):
            barcode = base_code if (qty == 1 and i == 0) else f"{base_code}-{i+1:02d}"
            cursor.execute("""
                INSERT INTO books (ma_vach, ten_sach, tac_gia, vi_tri_ke, gia_bia, trang_thai)
                VALUES (?, ?, ?, ?, ?, 'co_san')
            """, (barcode, req.ten_sach.strip(), req.tac_gia.strip(), req.vi_tri_ke.strip(), req.gia_bia))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Mã vạch này đã tồn tại trong kho thư viện!")
    conn.close()
    return {"status": "success", "message": f"Đã thêm thành công {qty} cuốn '{req.ten_sach}' vào kho!"}

# 6. Xóa toàn bộ đầu sách khỏi kho
@app.delete("/api/books/{book_id}")
def delete_book(book_id: int):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT trang_thai FROM books WHERE id = ?", (book_id,))
    b = cursor.fetchone()
    if not b:
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy sách!")
    if b[0] != 'co_san':
        conn.close()
        raise HTTPException(status_code=400, detail="Sách đang được mượn hoặc đã đặt giữ, không thể xóa!")
    cursor.execute("DELETE FROM books WHERE id = ?", (book_id,))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Đã xóa sách khỏi kho thư viện thành công."}

# Trạng thái 20 hộc tủ
@app.get("/api/lockers")
def get_lockers():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM lockers ORDER BY id ASC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# 1. API Lấy danh sách đơn soạn đã gom nhóm theo sinh viên + hộc tủ
@app.get("/api/librarian/orders")
def get_librarian_orders():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Lấy các đơn đang chờ soạn hoặc đã nạp hộc
    cursor.execute("""
        SELECT r.id, r.user_id, u.ho_ten, u.mssv, b.ten_sach, b.vi_tri_ke, b.ma_vach,
               l.so_hoc, l.id as locker_id, r.ngay_hen, r.khung_gio, r.trang_thai_don, r.qr_token
        FROM borrow_reservations r
        JOIN users u ON r.user_id = u.id
        JOIN books b ON r.book_id = b.id
        JOIN lockers l ON r.locker_id = l.id
        WHERE r.trang_thai_don IN ('cho_soan', 'da_soan_xong')
        ORDER BY r.id DESC
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    # Gom nhóm theo mã qr_token (mỗi lượt mượn của 1 sinh viên có 1 qr_token và 1 hộc)
    grouped = {}
    for r in rows:
        token = r["qr_token"]
        if token not in grouped:
            grouped[token] = {
                "qr_token": token,
                "ho_ten": r["ho_ten"],
                "mssv": r["mssv"],
                "so_hoc": r["so_hoc"],
                "locker_id": r["locker_id"],
                "ngay_hen": r["ngay_hen"],
                "khung_gio": r["khung_gio"],
                "trang_thai_don": r["trang_thai_don"],
                "books": []
            }
        grouped[token]["books"].append({
            "res_id": r["id"],
            "ten_sach": r["ten_sach"],
            "vi_tri_ke": r["vi_tri_ke"],
            "ma_vach": r["ma_vach"]
        })

    return list(grouped.values())

# 2. API Xác nhận nạp cả đơn vào hộc (1 LẦN BẤM DUY NHẤT)
@app.post("/api/librarian/ready-group")
def mark_order_group_ready(payload: dict):
    qr_token = payload.get("qr_token")
    if not qr_token:
        raise HTTPException(status_code=400, detail="Thiếu mã token!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE borrow_reservations SET trang_thai_don = 'da_soan_xong' WHERE qr_token = ?", (qr_token,))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Đã xác nhận nạp toàn bộ sách vào hộc thành công!"}

# 3. API Thu hồi cả đơn nếu sinh viên không đến nhận (1 LẦN BẤM DUY NHẤT)
@app.post("/api/librarian/cancel-expired-group")
def cancel_expired_order_group(payload: dict):
    qr_token = payload.get("qr_token")
    if not qr_token:
        raise HTTPException(status_code=400, detail="Thiếu mã token!")

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("SELECT book_id, locker_id FROM borrow_reservations WHERE qr_token = ?", (qr_token,))
    items = cursor.fetchall()

    if not items:
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn mượn này!")

    locker_id = items[0][1]

    # Trả tất cả sách về có sẵn
    for it in items:
        cursor.execute("UPDATE books SET trang_thai = 'co_san' WHERE id = ?", (it[0],))

    # Giải phóng hộc tủ và hủy đơn
    cursor.execute("UPDATE lockers SET trang_thai = 'trong', reservation_id = NULL WHERE id = ?", (locker_id,))
    cursor.execute("UPDATE borrow_reservations SET trang_thai_don = 'da_huy_do_qua_han' WHERE qr_token = ?", (qr_token,))

    conn.commit()
    conn.close()
    return {"status": "success", "message": "Đã thu hồi toàn bộ sách trong hộc về kho và mở trống tủ!"}

# Thủ thư bấm "Đã nạp vào hộc"
@app.post("/api/librarian/ready/{reservation_id}")
def mark_order_ready(reservation_id: int):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE borrow_reservations SET trang_thai_don = 'da_soan_xong' WHERE id = ?", (reservation_id,))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Đã xác nhận nạp sách thành công!"}

# Thủ thư thu hồi sách quá hạn lấy tại tủ
@app.post("/api/librarian/cancel-expired/{reservation_id}")
def cancel_expired_reservation(reservation_id: int):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT book_id, locker_id, trang_thai_don 
        FROM borrow_reservations 
        WHERE id = ?
    """, (reservation_id,))
    res = cursor.fetchone()

    if not res:
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn đặt hẹn này!")

    book_id, locker_id, status = res[0], res[1], res[2]

    if status not in ('cho_soan', 'da_soan_xong'):
        conn.close()
        raise HTTPException(status_code=400, detail="Đơn này không ở trạng thái chờ lấy sách tại tủ!")

    cursor.execute("UPDATE books SET trang_thai = 'co_san' WHERE id = ?", (book_id,))
    cursor.execute("UPDATE lockers SET trang_thai = 'trong', reservation_id = NULL WHERE id = ?", (locker_id,))
    cursor.execute("UPDATE borrow_reservations SET trang_thai_don = 'da_huy_do_qua_han' WHERE id = ?", (reservation_id,))

    conn.commit()
    conn.close()
    return {"status": "success", "message": "Đã thu hồi sách về kho và giải phóng hộc tủ thành công!"}

# 2. API Quét QR nhận sách tại Kiosk: MỞ 1 HỘC VÀ CẬP NHẬT TẤT CẢ CUỐN SÁCH CÙNG ĐƠN
@app.post("/api/locker/pickup")
def kiosk_scan_qr(req: PickupRequest):
    token = req.qr_token.strip()
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # KIỂM TRA 1: Nếu là mã TRẢ SÁCH (Bắt đầu bằng TRA-)
    if token.startswith("TRA-"):
        cursor.execute("""
            SELECT r.id, r.book_id, r.locker_id, l.so_hoc, r.han_tra, b.ten_sach
            FROM borrow_reservations r
            JOIN lockers l ON r.locker_id = l.id
            JOIN books b ON r.book_id = b.id
            WHERE r.qr_token = ? AND r.trang_thai_don = 'dang_muon'
        """, (token,))
        rows = cursor.fetchall()

        if not rows:
            conn.close()
            raise HTTPException(status_code=404, detail="Mã QR trả sách không hợp lệ hoặc đã được trả trước đó!")

        so_hoc = rows[0][3]
        locker_id = rows[0][2]
        today_str = datetime.now().strftime("%Y-%m-%d")

        # Cập nhật toàn bộ các cuốn sách vừa trả sang 'cho_kiem_tra'
        for r in rows:
            res_id, book_id, han_tra_str = r[0], r[1], r[4]
            fine = 0
            if han_tra_str:
                due_date = datetime.strptime(han_tra_str, "%Y-%m-%d")
                if datetime.now() > due_date:
                    days_late = (datetime.now() - due_date).days
                    fine = max(0, days_late * 5000)

            cursor.execute("""
                UPDATE borrow_reservations 
                SET trang_thai_don = 'cho_kiem_tra', ngay_tra = ?, tien_phat = ?
                WHERE id = ?
            """, (today_str, fine, res_id))
            cursor.execute("UPDATE books SET trang_thai = 'cho_kiem_tra' WHERE id = ?", (book_id,))

        # Đổi trạng thái hộc tủ thành chứa sách trả
        cursor.execute("UPDATE lockers SET trang_thai = 'chua_sach_tra', reservation_id = ? WHERE id = ?", (rows[0][0], locker_id))

        conn.commit()
        conn.close()

        titles = ", ".join([r[5] for r in rows])
        return {
            "status": "success",
            "opened_locker": so_hoc,
            "ten_sach": titles,
            "message": f"Chốt điện mở {so_hoc}! Vui lòng bỏ toàn bộ {len(rows)} cuốn sách vào hộc và đóng tủ."
        }

    # KIỂM TRA 2: Mã NHẬN SÁCH (Bắt đầu bằng QR-)
    cursor.execute("""
        SELECT r.id, r.book_id, r.locker_id, l.so_hoc, r.trang_thai_don, b.ten_sach
        FROM borrow_reservations r
        JOIN lockers l ON r.locker_id = l.id
        JOIN books b ON r.book_id = b.id
        WHERE r.qr_token = ?
    """, (token,))
    rows = cursor.fetchall()

    if not rows:
        conn.close()
        raise HTTPException(status_code=404, detail="Mã QR/PIN không hợp lệ!")

    status = rows[0][4]
    so_hoc = rows[0][3]
    locker_id = rows[0][2]

    if status == 'cho_soan':
        conn.close()
        raise HTTPException(status_code=400, detail="Sách đang được thủ thư chuẩn bị, chưa nạp vào hộc!")
    if status != 'da_soan_xong':
        conn.close()
        raise HTTPException(status_code=400, detail="Đơn sách này đã được nhận trước đó!")

    today_str = datetime.now().strftime("%Y-%m-%d")
    due_date_str = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")

    for r in rows:
        cursor.execute("""
            UPDATE borrow_reservations 
            SET trang_thai_don = 'dang_muon', ngay_muon = ?, han_tra = ?
            WHERE id = ?
        """, (today_str, due_date_str, r[0]))
        cursor.execute("UPDATE books SET trang_thai = 'dang_muon' WHERE id = ?", (r[1],))

    cursor.execute("UPDATE lockers SET trang_thai = 'trong', reservation_id = NULL WHERE id = ?", (locker_id,))

    conn.commit()
    conn.close()
    return {
        "status": "success",
        "opened_locker": so_hoc,
        "ten_sach": ", ".join([r[5] for r in rows]),
        "message": f"Chốt điện mở {so_hoc}! Vui lòng lấy {len(rows)} cuốn sách và đóng tủ."
    }

# Quét mã vạch trả sách tại Kiosk
@app.post("/api/locker/return")
def return_book(req: ReturnRequest):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT r.id, r.book_id, r.han_tra, b.ten_sach
        FROM borrow_reservations r
        JOIN books b ON r.book_id = b.id
        WHERE b.ma_vach = ? AND r.trang_thai_don = 'dang_muon'
        ORDER BY r.id DESC LIMIT 1
    """, (req.ma_vach.strip(),))
    res = cursor.fetchone()

    if not res:
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy lượt mượn nào của cuốn sách này đang mở!")

    res_id, book_id, han_tra_str, ten_sach = res[0], res[1], res[2], res[3]

    fine_amount = 0
    if han_tra_str:
        due_date = datetime.strptime(han_tra_str, "%Y-%m-%d")
        if datetime.now() > due_date:
            days_late = (datetime.now() - due_date).days
            fine_amount = max(0, days_late * 5000)

    cursor.execute("SELECT id, so_hoc FROM lockers WHERE trang_thai = 'trong' LIMIT 1")
    locker = cursor.fetchone()
    if not locker:
        conn.close()
        raise HTTPException(status_code=400, detail="Tất cả hộc tủ đều đã đầy, không còn chỗ nhận sách trả!")

    return_locker_id, return_so_hoc = locker[0], locker[1]
    today_str = datetime.now().strftime("%Y-%m-%d")

    cursor.execute("""
        UPDATE borrow_reservations 
        SET trang_thai_don = 'cho_kiem_tra', ngay_tra = ?, tien_phat = ?, locker_id = ?
        WHERE id = ?
    """, (today_str, fine_amount, return_locker_id, res_id))
    cursor.execute("UPDATE books SET trang_thai = 'cho_kiem_tra' WHERE id = ?", (book_id,))
    cursor.execute("UPDATE lockers SET trang_thai = 'chua_sach_tra', reservation_id = ? WHERE id = ?", (res_id, return_locker_id))

    conn.commit()
    conn.close()

    return {
        "status": "success",
        "opened_locker": return_so_hoc,
        "ten_sach": ten_sach,
        "tien_phat": fine_amount,
        "message": f"Mở {return_so_hoc} để trả sách. Vui lòng đặt sách vào hộc và đóng cửa tủ."
    }

# Thủ thư gom sách trả cuối ca
@app.post("/api/librarian/collect-all")
def collect_returned_books():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE lockers SET trang_thai = 'trong', reservation_id = NULL WHERE trang_thai = 'chua_sach_tra'")
    cursor.execute("UPDATE books SET trang_thai = 'co_san' WHERE trang_thai = 'cho_kiem_tra'")
    cursor.execute("UPDATE borrow_reservations SET trang_thai_don = 'hoan_tat' WHERE trang_thai_don = 'cho_kiem_tra'")
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Đã gom toàn bộ sách trả, xếp về kệ và giải phóng hộc tủ!"}
# ================== MỤC SỐ 4: BƯỚC 5 THỦ THƯ KIỂM TRA SÁCH TRẢ ==================
@app.post("/api/librarian/inspect-book")
def inspect_returned_book(req: InspectReturnRequest):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT r.book_id, r.user_id, r.tien_phat, r.locker_id 
        FROM borrow_reservations r 
        WHERE r.id = ?
    """, (req.reservation_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn sách này!")

    book_id, user_id, current_fine, locker_id = row[0], row[1], row[2], row[3]

    if req.tinh_trang == "binh_thuong":
        cursor.execute("UPDATE books SET trang_thai = 'co_san' WHERE id = ?", (book_id,))
        cursor.execute("UPDATE borrow_reservations SET trang_thai_don = 'hoan_tat' WHERE id = ?", (req.reservation_id,))
        msg = "Sách nguyên vẹn: Đã hoàn tất và cộng lại kho sách!"
    else:
        # Trường hợp sách bị hư hỏng / rách / mất trang
        total_fine = current_fine + req.tien_phat_them
        cursor.execute("UPDATE books SET trang_thai = 'hu_hong' WHERE id = ?", (book_id,))
        cursor.execute("""
            UPDATE borrow_reservations 
            SET trang_thai_don = 'hoan_tat_hu_hong', tien_phat = ? 
            WHERE id = ?
        """, (total_fine, req.reservation_id))
        # Ghi nhận nợ phạt vào tài khoản sinh viên
        cursor.execute("UPDATE users SET tien_no_phat = tien_no_phat + ? WHERE id = ?", (req.tien_phat_them, user_id))
        msg = f"Đã ghi nhận sách hư hỏng: Phạt thêm {req.tien_phat_them:,} đ vào tài khoản sinh viên!"

    # Kiểm tra nếu hộc tủ này đã kiểm tra hết sách thì giải phóng thành hộc trống
    cursor.execute("SELECT COUNT(*) FROM borrow_reservations WHERE locker_id = ? AND trang_thai_don = 'cho_kiem_tra'", (locker_id,))
    if cursor.fetchone()[0] == 0:
        cursor.execute("UPDATE lockers SET trang_thai = 'trong', reservation_id = NULL WHERE id = ?", (locker_id,))

    conn.commit()
    conn.close()
    return {"status": "success", "message": msg}

    # 1. API Lấy danh sách sách sinh viên đã bỏ vào tủ trả, chờ thủ thư kiểm tra
@app.get("/api/librarian/returns-inspect")
def get_inspect_returns():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.id, u.ho_ten, u.mssv, b.ten_sach, b.ma_vach, l.so_hoc, r.ngay_tra, r.tien_phat
        FROM borrow_reservations r
        JOIN users u ON r.user_id = u.id
        JOIN books b ON r.book_id = b.id
        JOIN lockers l ON r.locker_id = l.id
        WHERE r.trang_thai_don = 'cho_kiem_tra'
        ORDER BY r.id DESC
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# 2. API Truy vấn & Quản lý tất cả lượt mượn của Sinh viên dành cho Thủ thư
@app.get("/api/librarian/active-borrows")
def get_active_borrows_librarian():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.id as res_id, u.id as user_id, u.ho_ten, u.mssv, u.email,
               b.id as book_id, b.ten_sach, b.ma_vach, b.vi_tri_ke,
               r.ngay_muon, r.han_tra, r.trang_thai_don, r.tien_phat
        FROM borrow_reservations r
        JOIN users u ON r.user_id = u.id
        JOIN books b ON r.book_id = b.id
        WHERE r.trang_thai_don IN ('dang_muon', 'cho_kiem_tra')
        ORDER BY r.han_tra ASC, u.mssv ASC
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    today = datetime.now().date()
    for r in rows:
        r["is_late"] = False
        r["days_late"] = 0
        if r["han_tra"]:
            try:
                due_date = datetime.strptime(r["han_tra"], "%Y-%m-%d").date()
                if today > due_date:
                    r["is_late"] = True
                    r["days_late"] = (today - due_date).days
                    if r["tien_phat"] == 0:
                        r["tien_phat"] = r["days_late"] * 5000
            except Exception:
                pass
    return rows