'use strict';
// Dữ liệu khởi tạo (giữ nguyên danh sách trong app.py cũ)
const STAFF = [
  { mssv: 'THUTHU01', ho_ten: 'Thủ thư Thư viện DUE', email: 'thuthu@due.udn.vn', vai_tro: 'thu_thu' },
];
const STUDENTS = [
  ['251121514110', 'Phạm Nhật Hạ'],
  ['241121521143', 'Nguyễn Thị Phương Thảo'],
  ['241121521153', 'Trần Thị Thu Uyên'],
  ['241121521136', 'Đặng Mai Phương'],
  ['241121521133', 'Hoàng Ngọc Phương Nhi'],
].map(([mssv, ho_ten]) => ({ mssv, ho_ten, email: `${mssv}@due.udn.vn`, vai_tro: 'sinh_vien' }));

const BOOKS = [
  ['DUE-MIS-001', 'Quản lý Quy trình Kinh doanh (MIS3047)', 'Bộ môn HTTT', 'Tầng 2 - Kệ A1', 150000],
  ['DUE-MIS-002', 'Quản lý Quy trình Kinh doanh (MIS3047)', 'Bộ môn HTTT', 'Tầng 2 - Kệ A1', 150000],
  ['DUE-MIS-003', 'Quản trị Cơ sở Dữ liệu', 'Bộ môn HTTT', 'Tầng 2 - Kệ A2', 140000],
  ['DUE-MIS-004', 'Quản trị Cơ sở Dữ liệu', 'Bộ môn HTTT', 'Tầng 2 - Kệ A2', 140000],
  ['DUE-ECO-001', 'Kinh tế lượng ứng dụng', 'Khoa Kinh tế', 'Tầng 2 - Kệ B3', 135000],
  ['DUE-ACC-001', 'Nguyên lý Kế toán', 'Khoa Kế toán', 'Tầng 3 - Kệ C2', 95000],
  ['DUE-ACC-002', 'Kế toán Tài chính 1', 'Khoa Kế toán', 'Tầng 3 - Kệ C3', 115000],
  ['DUE-MAR-001', 'Marketing Căn bản', 'Khoa Marketing', 'Tầng 3 - Kệ D1', 110000],
  ['DUE-MAR-002', 'Hành vi Người tiêu dùng', 'Khoa Marketing', 'Tầng 3 - Kệ D2', 120000],
  ['DUE-FIN-001', 'Tài chính Doanh nghiệp', 'Khoa Tài chính', 'Tầng 1 - Kệ F2', 125000],
  ['DUE-FIN-002', 'Nghiệp vụ Ngân hàng Thương mại', 'Khoa Ngân hàng', 'Tầng 1 - Kệ F3', 130000],
  ['DUE-ECOM-001', 'Thương mại Điện tử Căn bản', 'Khoa TMĐT', 'Tầng 2 - Kệ E1', 118000],
  ['DUE-LAW-001', 'Pháp luật Đại cương & Luật Kinh tế', 'Khoa Luật', 'Tầng 3 - Kệ L1', 99000],
  ['DUE-STA-001', 'Nguyên lý Thống kê Kinh tế', 'Khoa Thống kê - Tin học', 'Tầng 2 - Kệ S1', 105000],
  ['DUE-IT-001', 'Lập trình Python phân tích dữ liệu', 'Bộ môn Tin học Quản lý', 'Tầng 2 - Kệ A3', 160000],
].map(([ma_vach, ten_sach, tac_gia, vi_tri_ke, gia_bia], i) => ({ id: i + 1, ma_vach, ten_sach, tac_gia, vi_tri_ke, gia_bia, trang_thai: 'co_san' }));

const LOCKERS = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1, so_hoc: `Hộc ${String(i + 1).padStart(2, '0')}`, trang_thai: 'trong', reservation_id: null, token: null, hold_until: null,
}));

module.exports = { STAFF, STUDENTS, BOOKS, LOCKERS };
