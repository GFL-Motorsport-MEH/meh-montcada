// Sustituto de @supabase/supabase-js para pruebas locales (sin red).
// Implementa solo lo que usa la app. Los usuarios salen de fixtures.json
// (profiles) y todos tienen la contraseña "secreto123".
const fx = await (await fetch('/__fixtures.json')).json();
const db = { ...fx };
const USERS = Object.fromEntries(fx.profiles.map((p) => [p.email, p.id]));
const PAGE_MAX = 1000;
let session = JSON.parse(sessionStorage.getItem('mock.session') || 'null');
const listeners = [];
const emit = (ev) => listeners.forEach((cb) => cb(ev, session));
let nextId = 1;
window.__mock = { db, calls: [] };
window.__claveFact = (r) => [r.id_crm ?? '', r.num_recibo ?? '', r.num_factura ?? '', r.descripcion ?? '', r.importe == null || r.importe === '' ? '' : Number(r.importe).toFixed(2)].join('|');

class Q {
  constructor(table) { this.t = table; this.filters = []; this.orders = []; this.op = 'select'; }
  select(cols, opts) { if (this.op === 'select') this.op = 'select'; this.ret = true; this.countOpt = opts && opts.count; return this; }
  eq(c, v) { this.filters.push([c, v]); return this; }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single_ = 'maybe'; return this; }
  single() { this.single_ = 'one'; return this; }
  insert(obj) { this.op = 'insert'; this.payload = obj; return this; }
  update(obj) { this.op = 'update'; this.payload = obj; return this; }
  upsert(obj, opts = {}) { this.op = 'upsert'; this.payload = obj; this.upOpts = opts; return this; }
  delete(opts) { this.op = 'delete'; this.countOpt = opts && opts.count; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
  exec() {
    window.__mock.calls.push({ t: this.t, op: this.op, filters: this.filters });
    if (!session) return { data: null, error: { message: 'permission denied' } };
    const yo = db.profiles.find((p) => p.id === session.user.id);
    const activo = yo && yo.activo; const admin = activo && yo.rol === 'admin';
    let rows = db[this.t];
    const match = (r) => this.filters.every(([c, v]) => r[c] === v);
    if (this.t !== 'profiles' && !activo) rows = [];
    if (this.t === 'profiles' && !admin) rows = rows.filter((r) => r.id === session.user.id);
    if (this.op === 'insert') {
      if (!activo) return { data: null, error: { message: 'new row violates row-level security policy' } };
      const row = { id: 'nuevo-' + (nextId++), updated_at: new Date().toISOString(), ...this.payload };
      db[this.t].push(row);
      return { data: this.single_ ? row : [row], error: null };
    }
    if (this.op === 'upsert') {
      if (!activo) return { data: null, error: { message: 'new row violates row-level security policy' } };
      const col = this.upOpts.onConflict;
      const clave = (r) => (this.t === 'facturacion' && col === 'clave_linea' ? window.__claveFact(r) : r[col]);
      const existentes = new Set(db[this.t].map(clave));
      const nuevos = [];
      for (const p of [].concat(this.payload)) {
        if (existentes.has(clave(p))) continue;
        const row = { id: 'nuevo-' + (nextId++), ...p };
        if (this.t === 'facturacion') row.clave_linea = window.__claveFact(row);
        existentes.add(clave(row)); db[this.t].push(row); nuevos.push(row);
      }
      return { data: nuevos, error: null };
    }
    if (this.op === 'update') {
      const t = rows.filter(match);
      if (this.t === 'profiles' && !admin) return { data: null, error: { message: 'row-level security' } };
      t.forEach((r) => Object.assign(r, this.payload, { updated_at: new Date().toISOString() }));
      return { data: this.single_ ? t[0] || null : t, error: this.single_ === 'one' && !t.length ? { message: 'JSON object requested, multiple (or no) rows returned' } : null };
    }
    if (this.op === 'delete') {
      if (!admin) return { data: null, error: null, count: 0 };
      const before = db[this.t].length;
      db[this.t] = db[this.t].filter((r) => !match(r));
      return { data: null, error: null, count: before - db[this.t].length };
    }
    let out = rows.filter(match);
    for (const [c, asc] of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => { const x = a[c] ?? '', y = b[c] ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
    }
    const [a, b] = this.rng || [0, PAGE_MAX - 1];
    out = out.slice(a, Math.min(b, a + PAGE_MAX - 1) + 1);
    if (this.single_) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
}

export function createClient() {
  return {
    from: (t) => new Q(t),
    async rpc(fn, args) {
      window.__mock.calls.push({ rpc: fn, args });
      const yo = session && db.profiles.find((p) => p.id === session.user.id);
      if (!(yo && yo.activo && yo.rol === 'admin')) return { data: null, error: { message: 'Solo un administrador puede cambiar las listas' } };
      if (fn === 'renombrar_valor_lista') {
        const { p_lista: l, p_anterior: a, p_nuevo: n } = args;
        let c = 0;
        db.gastos.forEach((g) => { if (g[l] === a) { g[l] = n; c++; } });
        const existe = db.listas.some((x) => x.lista === l && x.valor.toLowerCase() === n.toLowerCase() && x.valor.toLowerCase() !== a.toLowerCase());
        if (existe) db.listas = db.listas.filter((x) => !(x.lista === l && x.valor === a));
        else db.listas.forEach((x) => { if (x.lista === l && x.valor === a) x.valor = n; });
        return { data: c, error: null };
      }
      return { data: null, error: { message: 'función desconocida' } };
    },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        await new Promise((r) => setTimeout(r, 120));
        if (!USERS[email] || password !== 'secreto123') return { data: {}, error: { message: 'Invalid login credentials' } };
        session = { user: { id: USERS[email], email }, access_token: 'x' };
        sessionStorage.setItem('mock.session', JSON.stringify(session));
        emit('SIGNED_IN');
        return { data: { session }, error: null };
      },
      async signOut() { session = null; sessionStorage.removeItem('mock.session'); emit('SIGNED_OUT'); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async updateUser() { return { data: {}, error: null }; },
    },
  };
}
