// Tareas de Academia (sustituye a Google Keep). Todo se ve y se edita en la propia fila, sin ventanas aparte.
// Vistas: lista del día, por persona, semana, persona y fecha, y tablero por estado. Las tareas hechas se conservan (Ver hechas).
// Las áreas «Contabilidad» y «Domiciliaciones y pagos» solo las ven quienes tienen permiso de dinero (se aplica en la base de datos).
import { h, clear, cargando, toast, confirmar, hoyISO, normalizar } from '../ui.js';
import * as api from './api.js';
import { cabecera, refrescar } from './kit.js';
import { renderReuniones, llevarAReunion, nombreReunion, proxima, fechaCorta as fechaReu } from './reuniones.js';

const PRIO = ['Normal', 'Importante', 'Urgente'];
const AREAS = { aca: 'Académica', centro: 'Centro', conta: 'Contabilidad', pagos: 'Domiciliaciones y pagos' };
const AREAS_DINERO = ['conta', 'pagos'];
const ESTADOS = { pend: 'Pendiente', curso: 'En curso', hecha: 'Hecha' };
const GRUPOS = [['venc', 'Vencidas'], ['hoy', 'Hoy'], ['sem', 'Próximos 7 días'], ['des', 'Más adelante'], ['sin', 'Sin fecha'], ['hecha', 'Hechas']];
const S = { seccion: 'tareas', quien: 'todas', area: 'all', vista: 'lista', q: '', hechas: false, spec: null, sem: 0 };
const VISTAS = [['lista', 'Lista del día'], ['persona', 'Por persona'], ['semana', 'Semana'], ['matriz', 'Persona y fecha'], ['estado', 'Tablero']];
const COL_AREA = { aca: '#2a5bd7', centro: '#5a6b2a', conta: '#7a3fc0', pagos: '#a65f08' };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const diaCorto = (iso) => { const d = new Date(iso + 'T00:00'); return `${DIAS[d.getDay()]} ${d.getDate()}`; };
const fechaCorta = (iso) => { const d = new Date(iso + 'T00:00'); return `${d.getDate()} ${MESES[d.getMonth()]}`; };
const lunesDe = (iso) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtISO(d); };
const ayudaAbierta = () => { try { return localStorage.getItem('ac_tareas_ayuda') !== '0'; } catch { return true; } };
const guardarAyuda = (v) => { try { localStorage.setItem('ac_tareas_ayuda', v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

const fmtISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumarDias = (iso, n) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return fmtISO(d); };
const sumarMes = (iso) => { const d = new Date(iso + 'T00:00'); d.setMonth(d.getMonth() + 1); return fmtISO(d); };
const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const colorDe = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${x % 360} 42% 40%)`; };
const iniciales = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
const SIGLAS = new Map(); // nombre -> siglas (GF, MG, ML, PA…)
const avatar = (n) => (n ? h('span', { class: 'ac-av', title: n, style: `background:${colorDe(n)}` }, SIGLAS.get(n) || iniciales(n)) : h('span', { class: 'ac-av vacio', title: 'Sin asignar' }, '?'));
const hace = (ts) => { const m = Math.round((Date.now() - new Date(ts)) / 6e4); return m < 2 ? 'ahora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

function grupo(t, hoy) {
  if (t.estado === 'hecha') return 'hecha';
  if (!t.vence) return 'sin';
  if (t.vence < hoy) return 'venc';
  if (t.vence === hoy) return 'hoy';
  return t.vence <= sumarDias(hoy, 7) ? 'sem' : 'des';
}
const orden = (a, b) => (b.prioridad - a.prioridad) || (a.vence || '9999').localeCompare(b.vence || '9999') || b.created_at.localeCompare(a.created_at);
const sel = (opciones, valor, extra = {}) => h('select', extra, opciones.map(([v, l]) => h('option', { value: v, selected: v === valor }, l)));

// Tareas y Reuniones comparten pantalla: un conmutador arriba cambia de una a otra
export async function renderTareas(view, ctx) {
  const ir = (seccion, q) => { S.seccion = seccion; if (q != null) { S.q = q; S.hechas = true; S.quien = 'todas'; S.area = 'all'; S.spec = null; } refrescar(); };
  const conmutador = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Sección' }, [['tareas', 'Tareas'], ['reuniones', 'Reuniones']].map(([k, l]) =>
    h('button', { class: 'seg-btn', type: 'button', 'aria-selected': String(S.seccion === k), onclick: () => ir(k) }, l)));
  if (S.seccion === 'reuniones') return renderReuniones(view, ctx, { conmutador, verTarea: (titulo) => ir('tareas', titulo) });
  return renderLista(view, ctx, conmutador);
}

async function renderLista(view, ctx, conmutador) {
  clear(view, cargando());
  const [tareas, usuarios, reunionesDb, temasDb] = await Promise.all([api.tareas(), api.usuarios().catch(() => []), api.reuniones().catch(() => []), api.temas().catch(() => [])]);
  const yo = ctx.state.perfil;
  const miNombre = primerNombre(yo.nombre || yo.email);
  SIGLAS.clear();
  [...usuarios, yo].forEach((u) => { if (u?.siglas) SIGLAS.set(u.nombre || u.email, u.siglas.toUpperCase()); });
  const uPor = new Map([...usuarios, yo].filter(Boolean).map((u) => [u.id, u]));
  const editor = ctx.edita('ac_tareas');
  const verDinero = yo.rol === 'admin' || (ctx.ve('ac_pagos') && !yo.sin_dinero);
  const areasPropias = Object.keys(AREAS).filter((a) => verDinero || !AREAS_DINERO.includes(a));
  const recargar = () => { api.invalidar(); refrescar(); };
  const hoy = hoyISO();
  const nombreResp = (t) => (t.asignado_a ? (uPor.get(t.asignado_a)?.nombre || uPor.get(t.asignado_a)?.email) : null) || t.responsable || '';
  const claveResp = (t) => (t.asignado_a ? t.asignado_a : t.responsable ? 'r:' + t.responsable : '');
  const cont = h('div', { class: 'ac-tareas-cont' });
  const tiles = h('div', { class: 'ac-tiles' });
  const barraResp = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Persona' });
  const comAbierto = new Set(); const comTodos = new Set(); const abiertas = new Set();
  if (S.area !== 'all' && !areasPropias.includes(S.area)) S.area = 'all';

  // personas conocidas: usuarios + nombres escritos a mano en las tareas (clave = id de usuario o «r:nombre»)
  const personas = new Map();
  usuarios.forEach((u) => personas.set(u.id, u.nombre || u.email));
  personas.set(yo.id, yo.nombre || yo.email);
  tareas.forEach((t) => { const c = claveResp(t); if (c && !personas.has(c)) personas.set(c, nombreResp(t)); });
  const valorDe = (k) => (k === '' || k.startsWith('r:') ? k : 'u:' + k);
  const opcionesResp = (actual) => {
    const o = [['', 'Sin asignar'], ...[...personas.entries()].map(([k, n]) => [valorDe(k), n])];
    if (actual && !o.some(([k]) => k === actual)) o.push([actual, actual]);
    return o;
  };
  const valorResp = (t) => (t.asignado_a ? 'u:' + t.asignado_a : t.responsable ? 'r:' + t.responsable : '');
  const parcheResp = (v, nombre) => (v === '' ? { asignado_a: null, responsable: null } : v.startsWith('u:') ? { asignado_a: v.slice(2), responsable: null } : { asignado_a: null, responsable: nombre ?? v.slice(2) });

  async function guardar(t, parche) {
    try { Object.assign(t, await api.upd('ac_tareas', t.id, parche)); } catch (ex) { toast(ex.message, 'error'); }
    pintar();
  }
  async function cambiarEstado(t, estado) {
    if (t.estado === estado) return;
    try {
      const com = [...(t.comentarios || []), { sys: true, t: `${miNombre} pasó la tarea a «${ESTADOS[estado]}»`, at: new Date().toISOString() }];
      Object.assign(t, await api.upd('ac_tareas', t.id, { estado, comentarios: com }));
      if (estado === 'hecha' && t.repite) {
        const base = t.vence && t.vence > hoy ? t.vence : hoy;
        await api.ins('ac_tareas', { titulo: t.titulo, notas: t.notas, items: (t.items || []).map((i) => ({ ...i, ok: false })), vence: t.repite === 'semanal' ? sumarDias(base, 7) : sumarMes(base),
          prioridad: t.prioridad, etiqueta: t.etiqueta, asignado_a: t.asignado_a, responsable: t.responsable, area: t.area, repite: t.repite, origen: t.origen });
        toast('Hecha. Se ha creado la siguiente repetición.'); recargar(); return;
      }
    } catch (ex) { toast(ex.message, 'error'); }
    pintar();
  }
  async function comentar(t, texto) {
    if (!texto.trim()) return;
    try { Object.assign(t, await api.upd('ac_tareas', t.id, { comentarios: [...(t.comentarios || []), { by: yo.id, n: miNombre, t: texto.trim(), at: new Date().toISOString() }] })); comAbierto.delete(t.id); } catch (ex) { toast(ex.message, 'error'); }
    pintar();
  }

  // ---- alta rápida ----
  const nueva = h('input', { type: 'text', placeholder: 'Nueva tarea… (Enter para añadir)', class: 'ac-tarea-nueva', disabled: !editor, 'aria-label': 'Nueva tarea' });
  const nuevaArea = sel(areasPropias.map((a) => [a, AREAS[a]]), S.area !== 'all' ? S.area : 'aca', { 'aria-label': 'Área al crear', disabled: !editor });
  const nuevaResp = sel(opcionesResp(''), 'u:' + yo.id, { 'aria-label': 'Responsable al crear', disabled: !editor });
  const nuevaFecha = h('input', { type: 'date', 'aria-label': 'Fecha al crear', disabled: !editor });
  async function crear() {
    if (!nueva.value.trim()) return;
    try { await api.ins('ac_tareas', { titulo: nueva.value.trim(), area: nuevaArea.value, vence: nuevaFecha.value || null, ...parcheResp(nuevaResp.value, personas.get(nuevaResp.value.replace(/^u:/, ''))) }); nueva.value = ''; recargar(); } catch (ex) { toast(ex.message, 'error'); }
  }
  nueva.addEventListener('keydown', (e) => { if (e.key === 'Enter') crear(); });

  // ---- filtros ----
  function filas() {
    const q = normalizar(S.q);
    return tareas.filter((t) => {
      if (S.vista !== 'estado' && !S.hechas && t.estado === 'hecha') return false;
      if (S.area !== 'all' && t.area !== S.area) return false;
      if (S.quien === 'mias' && t.asignado_a !== yo.id) return false;
      if (S.quien === 'nadie' && claveResp(t)) return false;
      if (!['todas', 'mias', 'nadie'].includes(S.quien) && claveResp(t) !== S.quien) return false;
      if (q && !normalizar(`${t.titulo} ${t.notas || ''} ${t.etiqueta || ''} ${nombreResp(t)}`).includes(q)) return false;
      if (S.spec) {
        const g = grupo(t, hoy);
        if (S.spec === 'venc' && g !== 'venc') return false;
        if (S.spec === 'hoy' && g !== 'hoy') return false;
        if (S.spec === 'sem' && !['hoy', 'sem'].includes(g)) return false;
        if (S.spec === 'nadie' && (claveResp(t) || t.estado === 'hecha')) return false;
      }
      return true;
    });
  }

  // ---- una tarea, completa y editable en su sitio ----
  function bloque(t, enTablero) {
    const dis = !editor;
    const g = grupo(t, hoy);
    const items = t.items = Array.isArray(t.items) ? t.items : [];
    const guardarItems = () => guardar(t, { items: items.filter((i) => i.t.trim()) });
    const resp = valorResp(t);
    const selResp = sel(opcionesResp(resp), resp, { disabled: dis, 'aria-label': 'Responsable', class: 'ac-resp' });
    selResp.addEventListener('change', () => guardar(t, parcheResp(selResp.value, selResp.selectedOptions[0]?.textContent)));
    const coms = t.comentarios || [];
    const visibles = comTodos.has(t.id) ? coms : coms.slice(-3);
    const caja = h('input', { type: 'text', placeholder: 'Escribe un comentario y pulsa Intro', 'aria-label': 'Comentario' });
    caja.addEventListener('keydown', (e) => { if (e.key === 'Enter') comentar(t, caja.value); if (e.key === 'Escape') { comAbierto.delete(t.id); pintar(); } });
    const lineasNotas = Math.min(6, Math.max(1, (t.notas || '').split('\n').length));
    return h('div', { class: `ac-tarea${enTablero ? ' ac-tarjeta' : ' ac-trow'} prio${t.prioridad}${t.estado === 'hecha' ? ' hecha' : ''}`, dataset: { id: t.id } },
      h('div', { class: 'ac-t-l1' },
        enTablero && editor ? h('span', { class: 'ac-asa', draggable: 'true', title: 'Arrastra para mover', ondragstart: (e) => e.dataTransfer.setData('text/plain', t.id) }, '⋮⋮') : null,
        h('input', { type: 'checkbox', class: 'ac-cb', checked: t.estado === 'hecha', disabled: dis, 'aria-label': 'Hecha', onchange: (e) => cambiarEstado(t, e.target.checked ? 'hecha' : 'pend') }),
        h('input', { type: 'text', class: 'ac-t-titulo', value: t.titulo, disabled: dis, 'aria-label': 'Título de la tarea', onchange: (e) => { if (e.target.value.trim()) guardar(t, { titulo: e.target.value.trim() }); else e.target.value = t.titulo; } }),
        avatar(nombreResp(t)), selResp,
        h('button', { class: 'btn small ghost', type: 'button', title: 'Cerrar', onclick: () => { abiertas.delete(t.id); pintar(); } }, 'Cerrar ▴'),
        editor ? h('button', { class: 'ac-x', type: 'button', title: 'Borrar tarea', 'aria-label': 'Borrar tarea', onclick: async () => { if (await confirmar({ titulo: 'Borrar tarea', texto: t.titulo, ok: 'Borrar', peligro: true })) { try { await api.del('ac_tareas', t.id); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, '✕') : null),
      h('div', { class: 'ac-t-l2' },
        sel(Object.entries(ESTADOS), t.estado, { disabled: dis, 'aria-label': 'Estado', onchange: (e) => cambiarEstado(t, e.target.value) }),
        sel(areasPropias.concat(areasPropias.includes(t.area) ? [] : [t.area]).map((a) => [a, AREAS[a]]), t.area, { disabled: dis, 'aria-label': 'Área', class: AREAS_DINERO.includes(t.area) ? 'dinero' : '', onchange: (e) => guardar(t, { area: e.target.value }) }),
        h('input', { type: 'date', value: t.vence || '', disabled: dis, 'aria-label': 'Fecha límite', class: g === 'venc' ? 'venc' : g === 'hoy' ? 'hoy' : '', onchange: (e) => guardar(t, { vence: e.target.value || null }) }),
        g === 'venc' ? h('span', { class: 'ac-aviso' }, 'Vencida') : g === 'hoy' ? h('span', { class: 'ac-aviso hoy' }, 'Hoy') : null,
        sel(PRIO.map((p, i) => [String(i), p]), String(t.prioridad), { disabled: dis, 'aria-label': 'Prioridad', onchange: (e) => guardar(t, { prioridad: Number(e.target.value) }) }),
        sel([['', 'No se repite'], ['semanal', 'Cada semana'], ['mensual', 'Cada mes']], t.repite || '', { disabled: dis, 'aria-label': 'Repetición', onchange: (e) => guardar(t, { repite: e.target.value || null }) }),
        h('input', { type: 'text', class: 'ac-etq', value: t.etiqueta || '', placeholder: 'Etiqueta', disabled: dis, 'aria-label': 'Etiqueta', onchange: (e) => guardar(t, { etiqueta: e.target.value.trim() || null }) }),
        enReunion(t),
        dis ? null : reunionSel(t)),
      h('textarea', { class: 'ac-t-notas', rows: lineasNotas, placeholder: 'Notas…', disabled: dis, 'aria-label': 'Notas', onchange: (e) => guardar(t, { notas: e.target.value.trim() || null }) }, t.notas || ''),
      items.length || editor ? h('div', { class: 'ac-t-items' },
        items.map((it, i) => h('div', { class: 'ac-item' + (it.ok ? ' hecho' : '') },
          h('input', { type: 'checkbox', checked: it.ok, disabled: dis, 'aria-label': 'Elemento hecho', onchange: (e) => { it.ok = e.target.checked; guardarItems(); } }),
          h('input', { type: 'text', value: it.t, disabled: dis, 'aria-label': 'Elemento', onchange: (e) => { it.t = e.target.value; guardarItems(); } }),
          editor ? h('button', { class: 'ac-x', type: 'button', 'aria-label': 'Quitar elemento', onclick: () => { items.splice(i, 1); guardarItems(); } }, '✕') : null)),
        editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { items.push({ t: '', ok: false }); pintar(); } }, '+ Elemento') : null) : null,
      h('div', { class: 'ac-t-coms' },
        coms.length > visibles.length ? h('button', { class: 'link-btn small', type: 'button', onclick: () => { comTodos.add(t.id); pintar(); } }, `Ver ${coms.length - visibles.length} anteriores`) : null,
        visibles.map((c) => h('div', { class: 'ac-com' + (c.sys ? ' sys' : '') }, c.sys ? null : h('b', {}, `${c.n || uPor.get(c.by)?.nombre || 'Alguien'}: `), c.t, h('span', { class: 'muted' }, ' · hace ' + hace(c.at)))),
        editor ? (comAbierto.has(t.id) ? h('div', { class: 'ac-com-nuevo' }, caja, h('button', { class: 'btn small primary', type: 'button', onclick: () => comentar(t, caja.value) }, 'Enviar'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { comAbierto.delete(t.id); pintar(); } }, 'Cancelar'))
          : h('button', { class: 'btn small', type: 'button', onclick: () => { comAbierto.add(t.id); pintar(); } }, 'Comentar')) : null));
  }


  // ---- una tarea cerrada: una sola línea (clic para abrirla) ----
  function fechaRel(t, g) {
    if (t.estado === 'hecha') return t.hecha_at ? `hecha ${fechaCorta(String(t.hecha_at).slice(0, 10))}` : 'hecha';
    if (!t.vence) return '';
    const d = Math.round((new Date(t.vence + 'T00:00') - new Date(hoy + 'T00:00')) / 864e5);
    return d === 0 ? 'hoy' : d === 1 ? 'mañana' : d === -1 ? 'ayer' : d < 0 ? `hace ${-d} d` : d < 7 ? diaCorto(t.vence) : fechaCorta(t.vence);
  }
  function resumen(t, tarjeta, sinPersona) {
    const g = grupo(t, hoy);
    const its = Array.isArray(t.items) ? t.items : [];
    const nCom = (t.comentarios || []).filter((c) => !c.sys).length;
    const fr = fechaRel(t, g);
    const nombre = nombreResp(t);
    return h('div', { class: `ac-tarea ac-trow ac-res${tarjeta ? ' ac-tarjeta' : ''} prio${t.prioridad}${t.estado === 'hecha' ? ' hecha' : ''}`, dataset: { id: t.id } },
      tarjeta && editor ? h('span', { class: 'ac-asa', draggable: 'true', title: 'Arrastra para mover', ondragstart: (e) => e.dataTransfer.setData('text/plain', t.id) }, '⋮⋮') : null,
      h('input', { type: 'checkbox', class: 'ac-cb', checked: t.estado === 'hecha', disabled: !editor, 'aria-label': 'Hecha', onchange: (e) => cambiarEstado(t, e.target.checked ? 'hecha' : 'pend') }),
      h('button', { type: 'button', class: 'ac-res-t', title: 'Abrir la tarea', onclick: () => { abiertas.add(t.id); pintar(); } }, t.titulo),
      h('span', { class: 'ac-res-meta' },
        nCom ? h('span', { class: 'muted', title: 'Comentarios' }, `${nCom} com.`) : null,
        its.length ? h('span', { class: 'muted', title: 'Lista de comprobación' }, `${its.filter((i) => i.ok).length}/${its.length}`) : null,
        t.repite ? h('span', { class: 'muted', title: 'Se repite' }, '↻ ' + (t.repite === 'semanal' ? 'semanal' : 'mensual')) : null,
        h('span', { class: 'ac-chip', style: `--c:${COL_AREA[t.area] || '#666'}` }, AREAS[t.area] || t.area),
        fr ? h('span', { class: `ac-fecha${g === 'venc' ? ' venc' : g === 'hoy' ? ' hoy' : ''}` }, fr) : null,
        sinPersona ? null : h('span', { class: 'ac-quien' }, avatar(nombre), h('span', {}, nombre ? primerNombre(nombre) : 'Sin asignar'))));
  }
  const tarea = (t, tarjeta, sinPersona) => (abiertas.has(t.id) ? bloque(t, tarjeta) : resumen(t, tarjeta, sinPersona));

  // enlace con las reuniones: temas que apuntan a esta tarea y botón para llevarla a la próxima reunión
  function enReunion(t) {
    const ls = temasDb.filter((x) => x.tarea_id === t.id).map((x) => ({ x, r: reunionesDb.find((r) => r.id === x.reunion_id) })).filter((e) => e.r);
    return ls.length ? h('span', { class: 'ac-reu-ref muted small', title: 'Reuniones donde se habla de esta tarea' }, '🗓 ' + ls.map((e) => `${nombreReunion(e.r.tipo)} ${fechaReu(e.r.fecha)}`).join(' · ')) : null;
  }
  function reunionSel(t) {
    const opts = [['coordinacion', proxima('coordinacion')], ['profesoras', proxima('profesoras')]].filter(([, f]) => f);
    if (!opts.length) return null;
    const s = sel([['', 'Llevar a reunión…'], ...opts.map(([k, f]) => [k, `${nombreReunion(k)} · ${fechaReu(f)}`])], '', { 'aria-label': 'Llevar a reunión' });
    s.addEventListener('change', async () => {
      if (!s.value) return;
      try { const f = await llevarAReunion(s.value, t); toast(`Apuntada en la reunión de ${nombreReunion(s.value)} del ${fechaReu(f)}`); recargar(); } catch (ex) { toast(ex.message, 'error'); s.value = ''; }
    });
    return s;
  }

  function columna(titulo, total, tareasCol, onDrop, extra, sinPersona, clase) {
    const col = h('div', { class: 'ac-col' + (clase ? ' ' + clase : '') }, h('div', { class: 'ac-grupo-h' }, h('span', { class: 'ac-col-t' }, extra, titulo), h('span', {}, total)), tareasCol.map((t) => tarea(t, true, sinPersona)));
    col.addEventListener('dragover', (e) => { if (editor) { e.preventDefault(); col.classList.add('sobre'); } });
    col.addEventListener('dragleave', () => col.classList.remove('sobre'));
    col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('sobre'); const t = tareas.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t && editor) onDrop(t); });
    return col;
  }

  function pintar() {
    const lista = filas();
    if (S.vista === 'lista') {
      const bloques = GRUPOS.map(([k, titulo]) => {
        const it = lista.filter((t) => grupo(t, hoy) === k).sort(k === 'hecha' ? (a, b) => String(b.hecha_at || '').localeCompare(String(a.hecha_at || '')) : orden);
        return it.length ? h('div', { class: 'card ac-grupo' }, h('div', { class: `ac-grupo-h${k === 'venc' ? ' venc' : ''}` }, h('span', {}, titulo), h('span', {}, it.length)), it.map((t) => tarea(t, false))) : null;
      }).filter(Boolean);
      clear(cont, bloques.length ? bloques : h('div', { class: 'card empty' }, 'No hay tareas con estos filtros.'));
    } else if (S.vista === 'semana') {
      const ini = sumarDias(lunesDe(hoy), 7 * S.sem);
      const dias = [0, 1, 2, 3, 4, 5, 6].map((i) => sumarDias(ini, i));
      const atras = lista.filter((t) => t.estado !== 'hecha' && t.vence && t.vence < hoy).sort(orden);
      const sinF = lista.filter((t) => t.estado !== 'hecha' && !t.vence).sort(orden);
      const nav = h('div', { class: 'ac-sem-nav' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { S.sem--; pintar(); } }, '← Semana anterior'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { S.sem = 0; pintar(); } }, 'Esta semana'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { S.sem++; pintar(); } }, 'Semana siguiente →'),
        h('span', { class: 'muted small' }, `${fechaCorta(dias[0])} – ${fechaCorta(dias[6])}`));
      clear(cont, nav,
        atras.length ? columna('Atrasadas', atras.length, atras, (t) => guardar(t, { vence: hoy }), null, false, 'ac-banda venc') : null,
        h('div', { class: 'ac-semana' }, dias.map((d) => {
          const it = lista.filter((t) => t.vence === d && (d >= hoy || t.estado === 'hecha')).sort(orden);
          return columna(`${DIAS[new Date(d + 'T00:00').getDay()]} ${new Date(d + 'T00:00').getDate()}`, it.length, it, (t) => guardar(t, { vence: d }), null, false, d === hoy ? 'hoy' : '');
        })),
        columna('Sin fecha (arrastra a un día para ponerle fecha)', sinF.length, sinF, (t) => guardar(t, { vence: null }), null, false, 'ac-banda'));
    } else if (S.vista === 'matriz') {
      const colsM = GRUPOS.filter(([k]) => k !== 'hecha' || S.hechas);
      const otras = [...personas.keys()].filter((k) => k !== yo.id).sort((a, b) => String(personas.get(a)).localeCompare(String(personas.get(b))));
      const filasM = [yo.id, ...otras, ''];
      const cuerpo = [];
      filasM.forEach((k) => {
        const n = k === '' ? 'Sin asignar' : personas.get(k);
        const suyas = lista.filter((t) => claveResp(t) === k);
        if (!suyas.length && S.quien !== 'todas') return;
        const abiertasFila = suyas.filter((t) => abiertas.has(t.id));
        cuerpo.push(h('tr', { class: 'r' }, h('th', { scope: 'row' }, h('span', { class: 'ac-quien' }, avatar(k === '' ? '' : n), h('b', {}, k === yo.id ? `${miNombre} (tú)` : primerNombre(n) || n)), h('div', { class: 'muted small' }, `${suyas.filter((t) => t.estado !== 'hecha').length} abiertas`)),
          colsM.map(([g]) => h('td', {}, suyas.filter((t) => grupo(t, hoy) === g).sort(g === 'hecha' ? (a, b) => String(b.hecha_at || '').localeCompare(String(a.hecha_at || '')) : orden).map((t) =>
            h('button', { type: 'button', class: `ac-chipt prio${t.prioridad}${abiertas.has(t.id) ? ' on' : ''}${t.estado === 'hecha' ? ' hecha' : ''}`, title: t.titulo, onclick: () => { if (abiertas.has(t.id)) abiertas.delete(t.id); else abiertas.add(t.id); pintar(); } },
              h('i', { style: `background:${COL_AREA[t.area] || '#666'}` }), t.titulo))))));
        abiertasFila.forEach((t) => cuerpo.push(h('tr', { class: 'det' }, h('td', { colspan: colsM.length + 1 }, bloque(t, false)))));
      });
      clear(cont, h('div', { class: 'card ac-matriz-w' }, h('table', { class: 'ac-matriz' },
        h('thead', {}, h('tr', {}, h('th', {}), colsM.map(([k, l]) => h('th', { class: k === 'venc' ? 'venc' : '' }, l)))),
        h('tbody', {}, cuerpo))));
    } else if (S.vista === 'estado') {
      clear(cont, h('div', { class: 'ac-tablero' }, Object.entries(ESTADOS).map(([k, titulo]) => {
        const todas = lista.filter((t) => t.estado === k).sort(orden);
        return columna(titulo, todas.length, k === 'hecha' ? todas.sort((a, b) => String(b.hecha_at || '').localeCompare(String(a.hecha_at || ''))).slice(0, 30) : todas, (t) => cambiarEstado(t, k));
      })));
    } else {
      const otras = [...personas.keys()].filter((k) => k !== yo.id).sort((a, b) => String(personas.get(a)).localeCompare(String(personas.get(b))));
      const cols = [yo.id, ...otras].map((k) => [k, personas.get(k)]).concat([['', 'Sin asignar']]);
      clear(cont, h('div', { class: 'ac-tablero personas' }, cols.map(([k, n]) => {
        const it = lista.filter((t) => claveResp(t) === k).sort(orden);
        if (!it.length && S.quien !== 'todas') return null;
        return columna(k === yo.id ? `${miNombre} (tú)` : n, it.length, it, (t) => guardar(t, parcheResp(valorDe(k), n)), avatar(k === '' ? '' : n), true);
      }).filter(Boolean)));
    }
    const base = tareas.filter((t) => t.estado !== 'hecha' && (S.area === 'all' || t.area === S.area) && (S.quien === 'todas' || (S.quien === 'mias' ? t.asignado_a === yo.id : S.quien === 'nadie' ? !claveResp(t) : claveResp(t) === S.quien)));
    const n = (f) => base.filter((t) => f(grupo(t, hoy))).length;
    const sinResp = tareas.filter((t) => t.estado !== 'hecha' && !claveResp(t) && (S.area === 'all' || t.area === S.area)).length;
    const tile = (k, num, etiqueta, mal) => h('button', { type: 'button', class: `ac-tile${S.spec === k ? ' on' : ''}${mal && num ? ' mal' : ''}`, onclick: () => { S.spec = S.spec === k ? null : k; pintar(); } }, h('b', {}, num), h('span', {}, etiqueta));
    clear(tiles, tile('venc', n((g) => g === 'venc'), 'Vencidas', true), tile('hoy', n((g) => g === 'hoy'), 'Para hoy'), tile('sem', n((g) => g === 'hoy' || g === 'sem'), 'Próximos 7 días'), tile('nadie', sinResp, 'Sin responsable'));
    const otrasP = [...personas.entries()].filter(([k]) => k !== yo.id).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    clear(barraResp, [['todas', 'Todas'], ['mias', miNombre], ...otrasP, ['nadie', 'Sin asignar']].map(([k, l]) =>
      h('button', { class: 'seg-btn', type: 'button', 'aria-selected': String(S.quien === k), onclick: () => { S.quien = k; pintar(); } }, ['todas', 'mias', 'nadie'].includes(k) ? l : [avatar(l), ' ', primerNombre(l)])));
    document.querySelectorAll('.ac-chip').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.area === S.area)));
    document.querySelectorAll('.ac-vista .seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === S.vista)));
  }

  const chips = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Área' }, ['all', ...areasPropias].map((a) =>
    h('button', { class: 'seg-btn ac-chip', type: 'button', dataset: { area: a }, onclick: () => { S.area = a; pintar(); } }, a === 'all' ? 'Todas las áreas' : AREAS[a])));
  const vista = h('div', { class: 'segmented ac-vista', role: 'group', 'aria-label': 'Vista' }, VISTAS.map(([k, l]) =>
    h('button', { class: 'seg-btn', type: 'button', dataset: { v: k }, onclick: () => { S.vista = k; pintar(); } }, l)));
  const ayuda = leyenda(areasPropias, miNombre);
  ayuda.hidden = !ayudaAbierta();
  const btnAyuda = h('button', { class: 'btn small', type: 'button', 'aria-expanded': String(!ayuda.hidden), onclick: () => { ayuda.hidden = !ayuda.hidden; btnAyuda.setAttribute('aria-expanded', String(!ayuda.hidden)); guardarAyuda(!ayuda.hidden); } }, '? Cómo funciona');

  clear(view, cabecera('Tareas', `${tareas.filter((t) => t.estado !== 'hecha').length} pendientes`, conmutador, btnAyuda),
    ayuda, tiles,
    h('div', { class: 'ac-nueva' }, nueva, nuevaResp, nuevaArea, nuevaFecha, h('button', { class: 'btn primary', type: 'button', disabled: !editor, onclick: crear }, 'Añadir')),
    h('div', { class: 'ac-filtros' }, barraResp, chips, h('input', { type: 'search', placeholder: 'Buscar…', 'aria-label': 'Buscar tareas', value: S.q, oninput: (e) => { S.q = e.target.value; pintar(); } }),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: S.hechas, onchange: (e) => { S.hechas = e.target.checked; pintar(); } }), ` Ver hechas (${tareas.filter((t) => t.estado === 'hecha').length})`), vista),
    cont);
  pintar();
}

function leyenda(areasPropias, miNombre) {
  const p = (t, d) => h('li', {}, h('b', {}, t + ' '), d);
  return h('div', { class: 'card ac-ayuda' },
    h('h3', { class: 'sub-titulo' }, 'Cómo funciona'),
    h('ul', { class: 'small' },
      p('Crear.', 'Escribe el título, elige responsable, área y fecha (opcional) y pulsa Intro o «Añadir».'),
      p('Todo en la propia tarea.', 'Cambia estado, área, fecha, prioridad, repetición, notas y lista de comprobación directamente en su fila; se guarda solo. El botón «Comentar» abre la caja para escribir un comentario.'),
      p('Reuniones.', 'Arriba, «Reuniones»: cada lunes Coordinación y cada martes Profesoras (del 1 de septiembre al 20 de junio), más reuniones sueltas. Apunta temas a tratar; de cada tema puedes crear una tarea o enlazar una existente. Desde una tarea abierta, «Llevar a reunión…» la apunta en la próxima.'),
      p('Una línea por tarea.', 'Pulsa el título para abrirla y editarlo todo en su sitio; «Cerrar» la vuelve a plegar. El círculo de la izquierda la marca como hecha.'),
      p('Vistas.', 'Lista del día (Vencidas, Hoy, Próximos 7 días…), Por persona (una columna por responsable), Semana (calendario), Persona y fecha (quién y cuándo a la vez) y Tablero (Pendiente → En curso → Hecha). Arrastra con ⋮⋮ para reasignar, cambiar de día o de estado.'),
      p('Tareas hechas.', 'No se borran: quedan guardadas con su fecha. Marca «Ver hechas» para consultarlas (aparecen en el grupo «Hechas» y en la columna Hecha del tablero).'),
      p('Áreas.', 'Académica (alumnos, grupos, tutorías, eventos), Centro (mantenimiento, material, organización), Contabilidad (royalties, facturas, cobros) y Domiciliaciones y pagos (altas y bajas en domiciliaciones, cambios de cuota o de cuenta, recibos, devoluciones).'),
      p('Quién ve qué.', areasPropias.some((a) => AREAS_DINERO.includes(a)) ? 'Contabilidad y Domiciliaciones y pagos solo las ven las personas con permiso de dinero; quien no lo tiene no las ve ni se le pueden asignar.' : 'Tu usuario no tiene permiso de dinero, por eso no ves las áreas Contabilidad ni Domiciliaciones y pagos.'),
      p('Cambios en domiciliaciones y pagos.', 'Apunta aquí cada cambio antes de generar la remesa (alta, baja, cuota nueva, cuenta nueva, pago por Visa o transferencia) y márcalo como hecho cuando esté aplicado en Pagos/Remesas. No escribas IBAN: están en la ficha del alumno.'),
      p('Fechas y prioridad.', `Fecha en rojo, vencida. Los contadores de arriba filtran al hacer clic. La franja izquierda indica prioridad: ámbar importante, rojo urgente. «${miNombre}» filtra lo tuyo; «Sin asignar», lo que nadie lleva.`),
      p('Se repite.', 'Si una tarea es semanal o mensual, al marcarla como hecha se crea sola la siguiente.'),
      p('Etiqueta «Keep: …».', 'Tareas importadas de Google Keep: la etiqueta indica de qué nota venían.')));
}
