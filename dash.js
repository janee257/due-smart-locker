function toggleSidebar() { document.getElementById('dashAside').classList.toggle('open'); document.getElementById('dashOverlay').classList.toggle('open'); }
function closeSidebar() { document.getElementById('dashAside').classList.remove('open'); document.getElementById('dashOverlay').classList.remove('open'); }
function setBadge(id, n) { const e = document.getElementById(id); if (!e) return; e.innerText = n; e.classList.toggle('zero', !Number(n)); }
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Number(n) || 0).toLocaleString('vi-VN') + ' đ';