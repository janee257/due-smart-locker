/* ui.js: tăng cường trải nghiệm dùng chung (ẩn/hiện mật khẩu, skeleton, trạng thái mạng, đồng hồ kiosk). Không đụng tới logic nghiệp vụ. */
(function () {
  var page = location.pathname.indexOf('kiosk') >= 0 ? 'kiosk' : location.pathname.indexOf('librarian') >= 0 ? 'librarian' : 'student';

  window.UI = {
    // Khung xương tải dữ liệu: UI.skeleton(6) trả về HTML n thẻ giả
    skeleton: function (n) {
      var h = ''; for (var i = 0; i < (n || 6); i++) h += '<div class="skeleton sk-card" aria-hidden="true"></div>';
      return h;
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('page-' + page);

    // Nút hiện/ẩn mật khẩu cho mọi ô nhập mật khẩu
    document.querySelectorAll('input[type="password"]').forEach(function (input) {
      var wrap = document.createElement('div'); wrap.className = 'pw-wrap';
      input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pw-toggle';
      btn.setAttribute('aria-label', 'Hiện mật khẩu'); btn.setAttribute('aria-pressed', 'false'); btn.textContent = 'Hiện';
      btn.addEventListener('click', function () {
        var show = input.type === 'password'; input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Ẩn' : 'Hiện'; btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      });
      wrap.appendChild(btn);
    });

    if (page === 'kiosk') {
      // Đồng hồ trên header kiosk
      var header = document.querySelector('header');
      if (header) {
        var clock = document.createElement('div'); clock.className = 'kiosk-clock'; clock.setAttribute('aria-live', 'off'); header.appendChild(clock);
        var tick = function () { clock.textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' · ' + new Date().toLocaleDateString('vi-VN'); };
        tick(); setInterval(tick, 15000);
      }
      // Mất / có lại kết nối mạng
      var offlineToast = null;
      window.addEventListener('offline', function () {
        if (window.showToast) offlineToast = showToast({ type: 'error', title: 'Mất kết nối', message: 'Trạm đang chờ kết nối lại. Chưa thể xử lý giao dịch.', duration: 0 });
        var s = document.getElementById('connStatus'); if (s) { s.textContent = 'Mất kết nối'; s.className = 'text-xs font-normal text-red-400'; }
      });
      window.addEventListener('online', function () {
        if (offlineToast) offlineToast.close(); offlineToast = null;
        if (window.showToast) showToast.success('Đã kết nối lại', 'Trạm hoạt động bình thường.');
        var s = document.getElementById('connStatus'); if (s) { s.textContent = 'Firestore Trực tuyến'; s.className = 'text-xs font-normal text-emerald-400'; }
      });
    }
  });
})();