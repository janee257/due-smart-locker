/*! toast.js: Toast / Snackbar thuần JS, không phụ thuộc thư viện. CSS được tự nạp kèm theo.
 *
 *   showToast({ type: 'success', title: 'Thành công', message: 'Dữ liệu đã được lưu!' });
 *   showToast.error('Lỗi', 'Không thể kết nối máy chủ.');
 *
 * Tùy chọn: type (success | error | warning | info), title, message, duration (ms, 0 = không tự tắt),
 *           dismissible (mặc định true), onClose.
 * Cấu hình chung: showToast.configure({ position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left', duration: 4500, max: 5 })
 */
(function (root) {
  'use strict';

  var CSS = [
    '.dt-toasts{position:fixed;z-index:2147483000;display:flex;flex-direction:column;width:min(380px,calc(100vw - 48px));pointer-events:none;font-family:inherit}',
    '.dt-toasts[data-position$="right"]{right:24px;--dt-x:110%}',
    '.dt-toasts[data-position$="left"]{left:24px;--dt-x:-110%}',
    '.dt-toasts[data-position^="bottom"]{bottom:24px}',
    '.dt-toasts[data-position^="top"]{top:24px}',

    '.dt-item{margin-top:12px;pointer-events:auto;transition:height .3s ease,margin-top .3s ease,opacity .3s ease}',
    '.dt-item.is-leaving{height:0!important;margin-top:0;opacity:0;overflow:hidden}',

    '.dt-card{position:relative;display:flex;align-items:flex-start;gap:12px;padding:14px 44px 17px 14px;overflow:hidden;',
    'background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 10px 30px rgba(15,23,42,.18),0 0 0 1px rgba(15,23,42,.06);',
    'animation:dt-in .35s cubic-bezier(.21,1.02,.73,1) backwards;transition:transform .3s ease,opacity .3s ease}',
    '.is-leaving .dt-card{opacity:0;transform:translateX(calc(var(--dt-x) * .4))}',

    '.dt-icon{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--dt-soft);color:var(--dt-ink)}',
    '.dt-icon svg{width:18px;height:18px}',
    '.dt-body{flex:1;min-width:0}',
    '.dt-title{font-size:14px;font-weight:700;line-height:20px;overflow-wrap:anywhere}',
    '.dt-msg{margin-top:2px;font-size:13px;line-height:18px;color:#475569;overflow-wrap:anywhere;white-space:pre-line;',
    'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}',

    '.dt-close{position:absolute;top:8px;right:8px;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;',
    'background:transparent;color:#64748b;cursor:pointer;transition:background .15s,color .15s,transform .15s}',
    '.dt-close:hover{background:#f1f5f9;color:#0f172a;transform:scale(1.1)}',
    '.dt-close:focus-visible{outline:2px solid var(--dt-bar);outline-offset:1px}',
    '.dt-close svg{width:14px;height:14px}',

    '.dt-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--dt-bar);transform-origin:left center;',
    'animation:dt-bar var(--dt-dur) linear forwards}',
    '.dt-card:hover .dt-bar,.dt-card:focus-within .dt-bar{animation-play-state:paused}',

    '.dt-success{--dt-soft:#dcfce7;--dt-ink:#15803d;--dt-bar:#16a34a}',
    '.dt-error{--dt-soft:#fee2e2;--dt-ink:#b91c1c;--dt-bar:#dc2626}',
    '.dt-warning{--dt-soft:#fef3c7;--dt-ink:#92400e;--dt-bar:#d97706}',
    '.dt-info{--dt-soft:#dbeafe;--dt-ink:#1d4ed8;--dt-bar:#2563eb}',

    '@keyframes dt-in{from{opacity:0;transform:translateX(var(--dt-x))}to{opacity:1;transform:none}}',
    '@keyframes dt-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes dt-bar{to{transform:scaleX(0)}}',
    '@media (max-width:480px){.dt-toasts{left:16px!important;right:16px!important;width:auto}',
    '.dt-toasts[data-position^="bottom"]{bottom:16px}.dt-toasts[data-position^="top"]{top:16px}}',
    '@media (prefers-reduced-motion:reduce){.dt-card{animation:dt-fade .2s backwards}.is-leaving .dt-card{transform:none}}'
  ].join('');

  var SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = {
    success: SVG + '<path d="M5 10.5l3.2 3.2L15 7"/></svg>',
    error:   SVG + '<path d="M6.5 6.5l7 7M13.5 6.5l-7 7"/></svg>',
    warning: SVG + '<path d="M10 5.5v6M10 14.5h.01"/></svg>',
    info:    SVG + '<path d="M10 9v5.5M10 5.5h.01"/></svg>'
  };
  var CLOSE_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
  var TITLES = { success: 'Thành công', error: 'Lỗi', warning: 'Cảnh báo', info: 'Thông tin' };

  var config = { position: 'bottom-right', duration: 4500, max: 5 };
  var host = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text; // textContent: an toàn trước XSS
    return n;
  }

  function mount() {
    if (!document.getElementById('dt-styles')) {
      var st = el('style'); st.id = 'dt-styles'; st.textContent = CSS; document.head.appendChild(st);
    }
    if (!host || !host.isConnected) {
      host = el('div', 'dt-toasts');
      host.setAttribute('role', 'region');
      host.setAttribute('aria-label', 'Thông báo');
      document.body.appendChild(host);
    }
    host.setAttribute('data-position', config.position);
    return host;
  }

  function showToast(opts) {
    if (typeof opts === 'string') opts = { message: opts };
    var o = Object.assign({ type: 'info', title: '', message: '', duration: config.duration, dismissible: true }, opts);
    if (!ICONS[o.type]) o.type = 'info';
    var root = mount(), top = config.position.indexOf('top') === 0;

    // Quá số lượng tối đa: đóng thẻ cũ nhất
    var live = root.querySelectorAll('.dt-item:not(.is-leaving)');
    if (live.length >= config.max) live[top ? live.length - 1 : 0]._dtClose();

    var item = el('div', 'dt-item');
    var card = el('div', 'dt-card dt-' + o.type);
    card.setAttribute('role', o.type === 'error' || o.type === 'warning' ? 'alert' : 'status');

    var icon = el('div', 'dt-icon'); icon.innerHTML = ICONS[o.type];
    var body = el('div', 'dt-body');
    body.appendChild(el('div', 'dt-title', o.title || TITLES[o.type]));
    if (o.message) { var msg = el('div', 'dt-msg', o.message); msg.title = o.message; body.appendChild(msg); }
    card.appendChild(icon); card.appendChild(body);

    var closed = false;
    function close() {
      if (closed) return; closed = true;
      item.style.height = item.offsetHeight + 'px'; // chốt chiều cao để thu gọn mượt
      void item.offsetHeight;
      item.classList.add('is-leaving');
      setTimeout(function () { item.remove(); if (typeof o.onClose === 'function') o.onClose(); }, 320);
    }
    item._dtClose = close;

    if (o.dismissible) {
      var btn = el('button', 'dt-close'); btn.type = 'button';
      btn.setAttribute('aria-label', 'Đóng thông báo'); btn.innerHTML = CLOSE_ICON;
      btn.addEventListener('click', close);
      card.appendChild(btn);
    }
    if (o.duration > 0) { // thanh tiến trình CSS cũng là bộ đếm giờ: hover => tạm dừng cả hai cùng lúc
      var bar = el('div', 'dt-bar'); bar.style.setProperty('--dt-dur', o.duration + 'ms');
      bar.addEventListener('animationend', close);
      card.appendChild(bar);
    }

    item.appendChild(card);
    top ? root.prepend(item) : root.appendChild(item);
    return { close: close, element: item };
  }

  ['success', 'error', 'warning', 'info'].forEach(function (type) {
    showToast[type] = function (title, message, opts) {
      return showToast(Object.assign({}, opts, { type: type, title: title, message: message }));
    };
  });
  showToast.configure = function (opts) { Object.assign(config, opts); if (host) host.setAttribute('data-position', config.position); };
  showToast.clear = function () { if (host) host.querySelectorAll('.dt-item').forEach(function (i) { i._dtClose && i._dtClose(); }); };

  root.showToast = showToast;
  if (typeof module !== 'undefined' && module.exports) module.exports = showToast;
})(typeof window !== 'undefined' ? window : this);