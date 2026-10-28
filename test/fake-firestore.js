'use strict';
// Firestore giả lập trong bộ nhớ, đủ cho các thao tác service.js dùng.
// Có kiểm tra quy tắc thật của Firestore: trong transaction phải đọc hết rồi mới ghi.
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

class Snap {
  constructor(db, col, id) { this.db = db; this.id = id; this.ref = new Ref(db, col, id); this.exists = db.data.has(`${col}/${id}`); this._d = clone(db.data.get(`${col}/${id}`)); }
  data() { return clone(this._d); }
}
class Ref {
  constructor(db, col, id) { this.db = db; this.col = col; this.id = id; this.path = `${col}/${id}`; }
  async get() { return new Snap(this.db, this.col, this.id); }
}
class Query {
  constructor(db, col, filters = [], lim = null, order = null) { this.db = db; this.col = col; this.filters = filters; this.lim = lim; this.order = order; }
  doc(id) { return new Ref(this.db, this.col, String(id)); }
  where(f, op, v) { return new Query(this.db, this.col, [...this.filters, [f, op, v]], this.lim, this.order); }
  limit(n) { return new Query(this.db, this.col, this.filters, n, this.order); }
  orderBy(f, dir = 'asc') { return new Query(this.db, this.col, this.filters, this.lim, [f, dir]); }
  async get() {
    let rows = [];
    for (const [k, v] of this.db.data) {
      if (!k.startsWith(this.col + '/')) continue;
      const ok = this.filters.every(([f, op, val]) => (op === '==' ? v[f] === val : op === 'in' ? val.includes(v[f]) : false));
      if (ok) rows.push([k.slice(this.col.length + 1), v]);
    }
    if (this.order) { const [f, d] = this.order; rows.sort((a, b) => (a[1][f] > b[1][f] ? 1 : -1) * (d === 'desc' ? -1 : 1)); }
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    const docs = rows.map(([id]) => new Snap(this.db, this.col, id));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}
function apply(db, op) {
  const [kind, ref, data] = op;
  if (kind === 'set') db.data.set(ref.path, clone(data));
  else if (kind === 'update') {
    if (!db.data.has(ref.path)) throw new Error(`NOT_FOUND: update trên tài liệu chưa có ${ref.path}`);
    db.data.set(ref.path, { ...db.data.get(ref.path), ...clone(data) });
  } else if (kind === 'delete') db.data.delete(ref.path);
}
class Writer {
  constructor(db) { this.db = db; this.ops = []; }
  set(ref, d) { this.ops.push(['set', ref, d]); return this; }
  update(ref, d) { this.ops.push(['update', ref, d]); return this; }
  delete(ref) { this.ops.push(['delete', ref]); return this; }
  _commit() { this.ops.forEach((o) => apply(this.db, o)); }
}
class Tx extends Writer {
  _guard() { if (this.ops.length) throw new Error('Transaction: phải đọc hết trước khi ghi (reads after writes)'); }
  async get(x) { this._guard(); return x.get(); }
  async getAll(...refs) { this._guard(); return Promise.all(refs.map((r) => r.get())); }
}
class Batch extends Writer { async commit() { if (this.ops.length > 500) throw new Error('Batch > 500 thao tác'); this._commit(); } }

class FakeDb {
  constructor() { this.data = new Map(); this._lock = Promise.resolve(); this.txCount = 0; }
  collection(n) { return new Query(this, n); }
  doc(path) { const [c, ...rest] = path.split('/'); return new Ref(this, c, rest.join('/')); }
  async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); }
  batch() { return new Batch(this); }
  runTransaction(fn) { // tuần tự hóa: mô phỏng kết quả của isolation nghiêm ngặt trong Firestore
    const run = this._lock.then(async () => { const tx = new Tx(this); const out = await fn(tx); tx._commit(); this.txCount++; return out; });
    this._lock = run.catch(() => {});
    return run;
  }
  put(col, id, data) { this.data.set(`${col}/${id}`, clone(data)); }
  get(col, id) { return clone(this.data.get(`${col}/${id}`)); }
  all(col) { return [...this.data].filter(([k]) => k.startsWith(col + '/')).map(([, v]) => clone(v)); }
}
module.exports = { FakeDb };
