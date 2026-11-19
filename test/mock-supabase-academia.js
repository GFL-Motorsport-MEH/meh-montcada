// Supabase simulado para probar el módulo Academia (sin red). Un solo usuario admin ya con sesión.
const hoy = new Date().toISOString().slice(0, 10);
const ADMIN = { id: 'u-admin', email: 'admin@test.es', nombre: 'Admin Prueba', rol: window.__ROL || 'admin', activo: true, debe_cambiar_password: false, created_at: hoy };
const CURSOS = [{ id: 'c1', nombre: '2025.26', fecha_inicio: '2025-09-01', fecha_fin: '2026-08-31' }, { id: 'c2', nombre: '2026.27', fecha_inicio: '2026-09-01', fecha_fin: '2027-08-31' }];
const L = (lista, ...vals) => vals.map((valor, i) => ({ id: `l-${lista}-${i}`, lista, valor, orden: i }));
const ACAD = ['ac_alumnos', 'ac_pagos', 'ac_remesas', 'ac_seguimiento', 'ac_tutorias', 'ac_bajas', 'ac_grupos', 'ac_calendario', 'ac_recogidas', 'ac_tareas', 'ac_biblioteca', 'ac_documentos', 'ac_programaciones', 'ac_portal'];
const P = (rol, permiso, alcance, editar) => ({ rol, permiso, alcance, editar });
const TR = ['tr_contrato', 'tr_horas'];
const ROLES_DB = [{ rol: 'admin', nombre: 'Administrador', descripcion: 'Todo', orden: 0 }, { rol: 'direccion', nombre: 'Dirección', descripcion: '', orden: 1 }, { rol: 'coordinacion', nombre: 'Coordinación', descripcion: '', orden: 2 }, { rol: 'profesora', nombre: 'Profesora', descripcion: '', orden: 3 }, { rol: 'escaner', nombre: 'Solo escáner', descripcion: '', orden: 4 }];
const PERMISOS_DB = [
  P('direccion', 'ac_resumen', 'todo', false), ...ACAD.map((k) => P('direccion', k, 'todo', true)), ...TR.map((k) => P('direccion', k, 'todo', true)), P('direccion', 'escaner', 'todo', true),
  P('coordinacion', 'ac_resumen', 'todo', false), ...ACAD.filter((k) => !['ac_pagos', 'ac_remesas'].includes(k)).map((k) => P('coordinacion', k, 'todo', true)), ...TR.map((k) => P('coordinacion', k, 'propio', false)),
  P('profesora', 'ac_grupos', 'propio', false), P('profesora', 'ac_calendario', 'todo', false), P('profesora', 'ac_tutorias', 'propio', true), P('profesora', 'ac_seguimiento', 'propio', true), P('profesora', 'ac_biblioteca', 'todo', true), P('profesora', 'ac_documentos', 'todo', false), P('profesora', 'ac_portal', 'propio', false), ...TR.map((k) => P('profesora', k, 'propio', false)),
  P('escaner', 'escaner', 'todo', true),
];
const db = {
  roles: ROLES_DB, rol_permisos: PERMISOS_DB,
  profiles: [ADMIN], cursos: CURSOS, categorias: [], subcategorias: [], centros: [{ id: 'ce1', nombre: 'MONTCADA', principal: true, activo: true, orden: 0 }], gastos: [], listas: [], empresas: [],
  ac_listas: [...L('modalidad', 'Babies', 'Kids', 'Teens', 'Adults'), ...L('metodo_pago', 'Domiciliacion', 'Efectivo'), ...L('motivo_baja', 'Incompatibilidad horaria', 'Otros'), ...L('categoria_documento', 'Protocolo', 'Familias'), ...L('situacion_contacto', 'POSIBLE ALUMNO', 'EN ESPERA', 'APUNTADO'), ...L('como_conocio', 'Colegio', 'Instagram', 'Correo'), ...L('descuento', 'Hermanos')],
  ac_responsables: [], ac_responsables_priv: [], ac_vinculos: [], ac_profesoras: [], ac_aulas: [], ac_alumnos: [], ac_inscripciones: [], ac_grupos: [], ac_sesiones: [], ac_alumno_grupo: [], ac_remesas: [], ac_remesas_lista: [], ac_domiciliaciones: [], ac_domiciliacion_notas: [], ac_cuota_cambios: [], ac_remesa_envios: [], ac_remesa_envio_resumen: [], ac_remesa_envio_lineas: [], ac_cuotas: [], ac_wp_precios: [], ac_bajas: [], ac_contactos: [], ac_tutorias: [], ac_anotaciones: [], ac_tareas: [], ac_reuniones: [], ac_reunion_temas: [], ac_documentos: [], ac_prestamos: [], ac_biblioteca_items: [], ac_recogidas: [], ac_recogidas_pagos: [], ac_autorizados: [], ac_autorizados_priv: [], ac_calendario_dias: [], ac_calendario_marcas: [], ac_descuentos: [], ac_cuotas_tarifa: [], ac_nivel_historial: [], ac_portal_docs: [], tr_contratos: [], tr_horario: [], tr_horas: [], ui_preferencias: [], ui_orden_tablas: [],
};
const DEFAULTS = {
  ac_alumnos: { estado: 'inscrito', autoriza_rrss: false }, ac_cuotas: { estado: 'pendiente', concepto: 'mensualidad', mes: '', importe: 0 }, ac_grupos: { activo: true, capacidad: 8 },
  ac_tareas: { hecha: false, items: [], prioridad: 0, estado: 'pend', area: 'aca', comentarios: [] }, ac_documentos: { version: 1, estado: 'vigente', contenido: '' }, ac_profesoras: { activa: true, color: '#4f7cff' }, ac_aulas: { activa: true },
  ac_recogidas_pagos: { importe: 10, metodo: 'efectivo', traspasado_at: null }, ac_recogidas: { activa: true, dias: [], sale_solo: false, autorizacion_firmada: false }, ac_inscripciones: { cuota_mensual: 0, welcome_pack: 0, activa: true }, ac_remesas: { estado: 'borrador' }, ac_tutorias: { estado: 'pendiente', formato: 'presencial', fecha: hoy }, ac_anotaciones: { tipo: 'nota', fecha: hoy },
  ac_contactos: { situacion: 'POSIBLE ALUMNO' }, ac_bajas: { fecha_baja: hoy }, ac_alumno_grupo: {},
};
// relaciones embebidas: alias -> [tabla destino, columna, 'uno'|'muchos']  (columna = FK en la tabla que se lee o en la destino)
const REL = {
  ac_alumnos: { responsable: ['ac_responsables', 'responsable_id', 'uno'] },
  ac_grupos: { sesiones: ['ac_sesiones', 'grupo_id', 'muchos'], miembros: ['ac_alumno_grupo', 'grupo_id', 'muchos'] },
  ac_bajas: { alumno: ['ac_alumnos', 'alumno_id', 'uno'] },
  ac_remesa_envios: { resumen: ['ac_remesa_envio_resumen', 'envio_id', 'muchos'] },
  ac_recogidas: { alumno: ['ac_alumnos', 'alumno_id', 'uno'] }, ac_recogidas_pagos: { alumno: ['ac_alumnos', 'alumno_id', 'uno'] },
  ac_prestamos: { alumno: ['ac_alumnos', 'alumno_id', 'uno'] },
  ac_tutorias: { alumno: ['ac_alumnos', 'alumno_id', 'uno'], profesora: ['ac_profesoras', 'profesora_id', 'uno'] },
  ac_anotaciones: { alumno: ['ac_alumnos', 'alumno_id', 'uno'], profesora: ['ac_profesoras', 'profesora_id', 'uno'] },
};
let session = { user: { id: ADMIN.id, email: ADMIN.email }, access_token: 'x' };
const listeners = [];
let nextId = 1;
window.__mock = { db, calls: [] };

class Q {
  constructor(t) { this.t = t; this.f = []; this.orders = []; this.op = 'select'; }
  select(cols) { this.cols = cols || '*'; this.ret = true; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this; }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single_ = 'maybe'; return this; }
  single() { this.single_ = 'one'; return this; }
  insert(o) { this.op = 'insert'; this.payload = o; return this; }
  update(o) { this.op = 'update'; this.payload = o; return this; }
  upsert(o, opts = {}) { this.op = 'upsert'; this.payload = o; this.up = opts; return this; }
  delete() { this.op = 'delete'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
  embed(r) {
    const out = { ...r };
    for (const [, alias, tabla, cols] of (this.cols || '').matchAll(/(\w+):(\w+)\(([^)]*)\)/g)) {
      const rel = REL[this.t]?.[alias]; if (!rel) continue;
      const [dest, col, tipo] = rel;
      if (tipo === 'uno') { const o = db[dest].find((x) => x.id === r[col]); out[alias] = o ? { ...o } : null; }
      else out[alias] = db[dest].filter((x) => x[col] === r.id).map((x) => ({ ...x }));
    }
    return out;
  }
  aplicarDefaults(p) {
    const r = { id: 'id-' + (nextId++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: ADMIN.id, ...(DEFAULTS[this.t] || {}), ...p };
    if (this.t === 'ac_alumnos') r.nombre_completo = `${r.nombre} ${r.apellidos}`.trim();
    return r;
  }
  exec() {
    window.__mock.calls.push({ t: this.t, op: this.op });
    if (!db[this.t]) db[this.t] = []; // tablas de Facturación que esta prueba no usa
    const match = (r) => this.f.every((fn) => fn(r));
    if (this.op === 'insert') {
      const rows = [].concat(this.payload).map((p) => this.aplicarDefaults(p));
      for (const r of rows) {
        if (this.t === 'ac_alumnos' && r.num && db.ac_alumnos.some((x) => x.num === r.num)) return { data: null, error: { message: 'duplicate key value violates unique constraint "ac_alumnos_num_uq"' } };
        if (this.t === 'ac_cuotas' && db.ac_cuotas.some((x) => ['alumno_id', 'curso_id', 'concepto', 'mes'].every((k) => x[k] === r[k]))) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
      }
      db[this.t].push(...rows);
      return { data: this.single_ ? rows[0] : rows, error: null };
    }
    if (this.op === 'upsert') {
      const cols = (this.up.onConflict || 'id').split(',').map((c) => c.trim()); const out = [];
      for (const p of [].concat(this.payload)) {
        const ex = db[this.t].find((x) => cols.every((c) => x[c] !== undefined && x[c] !== null && x[c] === p[c]));
        if (ex) { if (!this.up.ignoreDuplicates) { Object.assign(ex, p); if (this.t === 'ac_alumnos') ex.nombre_completo = `${ex.nombre} ${ex.apellidos}`.trim(); out.push(ex); } continue; }
        const r = this.aplicarDefaults(p); db[this.t].push(r); out.push(r);
      }
      return { data: this.single_ ? out[0] || null : out.map((r) => ({ ...r })), error: null };
    }
    if (this.op === 'update') {
      const t = db[this.t].filter(match);
      t.forEach((r) => { Object.assign(r, this.payload, { updated_at: new Date().toISOString() }); if (this.t === 'ac_alumnos') r.nombre_completo = `${r.nombre} ${r.apellidos}`.trim(); });
      return { data: this.single_ ? t[0] || null : t, error: this.single_ === 'one' && !t.length ? { message: 'no rows' } : null };
    }
    if (this.op === 'delete') { db[this.t] = db[this.t].filter((r) => !match(r)); return { data: null, error: null }; }
    let out = db[this.t].filter(match);
    for (const [c, asc] of [...this.orders].reverse()) out = [...out].sort((a, b) => { const x = a[c] ?? '', y = b[c] ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
    const [a, b] = this.rng || [0, 999]; out = out.slice(a, b + 1).map((r) => this.embed(r));
    if (this.single_) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
}
export function createClient() {
  return {
    from: (t) => new Q(t),
    storage: { from: () => ({ async upload(ruta) { (window.__mock.uploads = window.__mock.uploads || []).push(ruta); return { data: {}, error: null }; }, async remove() { return { data: [], error: null }; }, getPublicUrl: (r) => ({ data: { publicUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } }), async createSignedUrl() { return { data: { signedUrl: 'about:blank' }, error: null }; } }) },
    functions: {
      async invoke(fn, { body } = {}) {
        window.__mock.calls.push({ fn, body });
        const ps = db.profiles;
        if (fn === 'escanear-ficha') {
          if (window.__SIN_CLAVE) return { data: { error: 'sin_clave' }, error: null };
          return { data: { datos: { alumno: { apellidos: 'Pérez Gil', nombre: 'Lucía', fecha_nacimiento: '2016-03-04', colegio: 'Escola Prova', alergias: 'Frutos secos', autoriza_rrss: true, modalidad: 'Kids' }, responsable: { apellidos: 'Pérez', nombre: 'Marta', email: 'marta@test.es', telefono: '600 111 222', dni: '11111111H', iban: 'ES11 2222 3333 4444 5555 6666' }, dudas: ['teléfono dudoso'] } }, error: null };
        }
        if (body?.accion === 'crear') {
          if (body.email && ps.some((x) => x.email === body.email)) return { data: { error: 'Ya existe un usuario con ese email' }, error: null };
          const perfil = { id: 'u-' + (ps.length + 1), email: body.email || null, nombre: body.nombre, rol: body.rol, activo: true, debe_cambiar_password: !!body.email, created_at: hoy };
          ps.push(perfil); return { data: { perfil }, error: null };
        }
        if (body?.accion === 'email') {
          const p = ps.find((x) => x.id === body.user_id);
          if (ps.some((x) => x.id !== p.id && x.email === body.email)) return { data: { error: 'Ya existe un usuario con ese email' }, error: null };
          const nuevo = !p.email; p.email = body.email; if (nuevo) p.debe_cambiar_password = true;
          return { data: { perfil: p, acceso_nuevo: nuevo }, error: null };
        }
        if (body?.accion === 'bloquear') { const p = ps.find((x) => x.id === body.user_id); p.activo = !body.bloquear; return { data: { perfil: p }, error: null }; }
        if (body?.accion === 'borrar') { db.profiles = ps.filter((x) => x.id !== body.user_id); return { data: { ok: true }, error: null }; }
        return { data: {}, error: null };
      },
    },
    async rpc(fn, args) {
      window.__mock.calls.push({ rpc: fn, args });
      if (fn === 'ac_generar_cuotas') {
        let n = 0;
        for (const i of db.ac_inscripciones.filter((x) => x.curso_id === args.p_curso && x.activa && Number(x.cuota_mensual) > 0)) {
          const al = db.ac_alumnos.find((a) => a.id === i.alumno_id); if (!al || al.estado !== 'inscrito') continue;
          if (db.ac_cuotas.some((c) => c.alumno_id === i.alumno_id && c.curso_id === i.curso_id && c.concepto === 'mensualidad' && c.mes === args.p_mes)) continue;
          db.ac_cuotas.push({ id: 'id-' + (nextId++), alumno_id: i.alumno_id, curso_id: i.curso_id, concepto: 'mensualidad', mes: args.p_mes, importe: i.cuota_mensual, estado: 'pendiente', metodo_pago: al.metodo_pago, created_at: new Date().toISOString() }); n++;
        }
        return { data: n, error: null };
      }
      if (fn === 'equipo_tareas') return { data: db.profiles.map((x) => ({ id: x.id, nombre: x.nombre, email: x.email, rol: x.rol, siglas: x.siglas })), error: null };
      return { data: null, error: { message: 'función desconocida' } };
    },
    auth: {
      async getUser() { return { data: { user: session ? session.user : null }, error: null }; },
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { session = null; return { error: null }; }, async signInWithPassword() { return { data: { session }, error: null }; }, async resetPasswordForEmail() { return { data: {}, error: null }; }, async updateUser() { return { data: {}, error: null }; },
    },
  };
}
