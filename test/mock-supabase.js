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
