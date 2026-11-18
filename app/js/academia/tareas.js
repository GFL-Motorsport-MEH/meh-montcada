// Tareas de Academia (sustituye a Google Keep): lista por vencimiento y tablero, con áreas, responsables, repetición y comentarios.
// Las áreas «Contabilidad» y «Domiciliaciones y pagos» solo las ven quienes tienen permiso de dinero (se aplica en la base de datos).
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, guardarBoton, refrescar } from './kit.js';

const PRIO = ['Normal', 'Importante', 'Urgente'];
const AREAS = { aca: 'Académica', centro: 'Centro', conta: 'Contabilidad', pagos: 'Domiciliaciones y pagos' };
const AREAS_DINERO = ['conta', 'pagos'];
const ESTADOS = { pend: 'Pendiente', curso: 'En curso', hecha: 'Hecha' };
const GRUPOS = [['venc', 'Vencidas'], ['hoy', 'Hoy'], ['sem', 'Próximos 7 días'], ['des', 'Más adelante'], ['sin', 'Sin fecha'], ['hecha', 'Hechas']];
const S = { quien: 'todas', area: 'all', vista: 'lista', q: '', hechas: false, spec: null };
const ayudaAbierta = () => { try { return localStorage.getItem('ac_tareas_ayuda') !== '0'; } catch { return true; } };
const guardarAyuda = (v) => { try { localStorage.setItem('ac_tareas_ayuda', v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

const fmtISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumarDias = (iso, n) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return fmtISO(d); };
const sumarMes = (iso) => { const d = new Date(iso + 'T00:00'); d.setMonth(d.getMonth() + 1); return fmtISO(d); };

function grupo(t, hoy) {
  if (t.estado === 'hecha') return 'hecha';
  if (!t.vence) return 'sin';
  if (t.vence < hoy) return 'venc';
  if (t.vence === hoy) return 'hoy';
  return t.vence <= sumarDias(hoy, 7) ? 'sem' : 'des';
}
const orden = (a, b) => (b.prioridad - a.prioridad) || (a.vence || '9999').localeCompare(b.vence || '9999') || b.created_at.localeCompare(a.created_at);

export async function renderTareas(view, ctx) {
  clear(view, cargando());
  const [tareas, usuarios] = await Promise.all([api.tareas(), api.usuarios().catch(() => [])]);
  const yo = ctx.state.perfil;
  const uPor = new Map([...usuarios, yo].filter(Boolean).map((u) => [u.id, u]));
  const editor = ctx.puedeEditar();
  const verDinero = yo.rol === 'admin' || !yo.sin_dinero;
  const areasPropias = Object.keys(AREAS).filter((a) => verDinero || !AREAS_DINERO.includes(a));
  const recargar = () => { api.invalidar(); refrescar(); };
  const hoy = hoyISO();
  const nombreResp = (t) => (t.asignado_a ? (uPor.get(t.asignado_a)?.nombre || uPor.get(t.asignado_a)?.email) : null) || t.responsable || '';
  const claveResp = (t) => (t.asignado_a ? t.asignado_a : t.responsable ? 'r:' + t.responsable : '');
  const cont = h('div', { class: 'ac-tareas-cont' });
  const tiles = h('div', { class: 'ac-tiles' });
  const barraResp = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Responsable' });

  if (S.area !== 'all' && !areasPropias.includes(S.area)) S.area = 'all';

  async function guardarEstado(t, estado) {
    if (t.estado === estado) return;
    try {
      const com = [...(t.comentarios || []), { sys: true, t: `${yo.nombre || yo.email} pasó la tarea a «${ESTADOS[estado]}»`, at: new Date().toISOString() }];
      Object.assign(t, await api.upd('ac_tareas', t.id, { estado, comentarios: com }));
      if (estado === 'hecha' && t.repite) {
        const base = t.vence && t.vence > hoy ? t.vence : hoy;
        await api.ins('ac_tareas', { titulo: t.titulo, notas: t.notas, items: (t.items || []).map((i) => ({ ...i, ok: false })), vence: t.repite === 'semanal' ? sumarDias(base, 7) : sumarMes(base),
          prioridad: t.prioridad, etiqueta: t.etiqueta, asignado_a: t.asignado_a, responsable: t.responsable, area: t.area, repite: t.repite, origen: t.origen });
        toast('Hecha. Se ha creado la siguiente repetición.');
      }
      recargar();
    } catch (ex) { toast(ex.message, 'error'); }
  }

  const nueva = h('input', { type: 'text', placeholder: 'Nueva tarea… (Enter para añadir)', class: 'ac-tarea-nueva', disabled: !editor, 'aria-label': 'Nueva tarea' });
  const nuevaArea = h('select', { 'aria-label': 'Área al crear', disabled: !editor }, areasPropias.map((a) => h('option', { value: a, selected: a === (S.area !== 'all' ? S.area : 'aca') }, AREAS[a])));
  nueva.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !nueva.value.trim()) return;
    try { await api.ins('ac_tareas', { titulo: nueva.value.trim(), area: nuevaArea.value, asignado_a: yo.id }); nueva.value = ''; recargar(); } catch (ex) { toast(ex.message, 'error'); }
  });

  function filas(ignorarSpec) {
    const q = normalizar(S.q);
    return tareas.filter((t) => {
      if (S.vista === 'lista' && !S.hechas && t.estado === 'hecha') return false;
      if (S.area !== 'all' && t.area !== S.area) return false;
      if (S.quien === 'mias' && t.asignado_a !== yo.id) return false;
      if (S.quien === 'nadie' && claveResp(t)) return false;
      if (!['todas', 'mias', 'nadie'].includes(S.quien) && claveResp(t) !== S.quien) return false;
      if (q && !normalizar(`${t.titulo} ${t.notas || ''} ${t.etiqueta || ''} ${nombreResp(t)}`).includes(q)) return false;
      if (!ignorarSpec && S.spec) {
        const g = grupo(t, hoy);
        if (S.spec === 'venc' && g !== 'venc') return false;
        if (S.spec === 'hoy' && g !== 'hoy') return false;
        if (S.spec === 'sem' && !['hoy', 'sem'].includes(g)) return false;
        if (S.spec === 'nadie' && (claveResp(t) || t.estado === 'hecha')) return false;
      }
      return true;
    });
  }

  function pastillas(t) {
    const g = grupo(t, hoy);
    const items = Array.isArray(t.items) ? t.items : [];
    return [
      items.length ? h('span', { class: 'small muted', title: 'Lista de comprobación' }, `${items.filter((i) => i.ok).length}/${items.length}`) : null,
      t.repite ? h('span', { class: 'pill off', title: 'Se repite' }, '↻ ' + t.repite) : null,
      h('span', { class: `pill ${AREAS_DINERO.includes(t.area) ? 'warn' : 'off'}` }, AREAS[t.area]),
      t.vence ? h('span', { class: `pill ${g === 'venc' ? 'warn' : 'off'}${g === 'venc' ? ' ac-venc' : ''}` }, g === 'hoy' ? 'Hoy' : (g === 'venc' ? 'Vencida · ' : '') + fmtFecha(t.vence)) : null,
      nombreResp(t) ? h('span', { class: 'ac-quien' }, nombreResp(t)) : h('span', { class: 'ac-quien muted' }, 'Sin asignar')];
  }
  const abrirT = (t) => abrir(t, { uPor, ctx, recargar, areasPropias, nombreResp });
  function fila(t) {
    return h('div', { class: `ac-trow prio${t.prioridad}${t.estado === 'hecha' ? ' hecha' : ''}` },
      h('input', { type: 'checkbox', checked: t.estado === 'hecha', disabled: !editor, 'aria-label': 'Hecha', onchange: (e) => guardarEstado(t, e.target.checked ? 'hecha' : 'pend') }),
      h('button', { class: 'ac-ttitulo link-btn', type: 'button', onclick: () => abrirT(t) }, t.titulo, t.estado === 'curso' ? h('span', { class: 'pill ok', style: 'margin-left:6px' }, 'En curso') : null),
      h('span', { class: 'ac-tmeta' }, pastillas(t)));
  }
  function tarjeta(t) {
    return h('div', { class: `card ac-tarjeta prio${t.prioridad}${t.estado === 'hecha' ? ' hecha' : ''}`, draggable: editor ? 'true' : null, dataset: { id: t.id },
      ondragstart: (e) => e.dataTransfer.setData('text/plain', t.id) },
      h('button', { class: 'ac-tarjeta-titulo link-btn', type: 'button', onclick: () => abrirT(t) }, t.titulo), h('div', { class: 'ac-meta small' }, pastillas(t)));
  }

  function pintar() {
    const lista = filas();
    if (S.vista === 'lista') {
      const bloques = GRUPOS.map(([k, titulo]) => {
        const it = lista.filter((t) => grupo(t, hoy) === k).sort(orden);
        return it.length ? h('div', { class: 'card ac-grupo' }, h('div', { class: `ac-grupo-h${k === 'venc' ? ' venc' : ''}` }, h('span', {}, titulo), h('span', {}, it.length)), it.map(fila)) : null;
      }).filter(Boolean);
      clear(cont, bloques.length ? bloques : h('div', { class: 'card empty' }, 'No hay tareas con estos filtros.'));
    } else {
      clear(cont, h('div', { class: 'ac-tablero' }, Object.entries(ESTADOS).map(([k, titulo]) => {
        let it = lista.filter((t) => t.estado === k).sort(orden);
        const total = it.length; if (k === 'hecha') it = it.slice(0, 15);
        const col = h('div', { class: 'ac-col', dataset: { col: k } }, h('div', { class: 'ac-grupo-h' }, h('span', {}, titulo), h('span', {}, total)), it.map(tarjeta));
        col.addEventListener('dragover', (e) => { if (editor) { e.preventDefault(); col.classList.add('sobre'); } });
        col.addEventListener('dragleave', () => col.classList.remove('sobre'));
        col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('sobre'); const t = tareas.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t && editor) guardarEstado(t, k); });
        return col;
      })));
    }
    const base = filas(true).filter((t) => t.estado !== 'hecha' || S.vista !== 'lista');
    const n = (f) => base.filter((t) => t.estado !== 'hecha' && f(grupo(t, hoy))).length;
    const sinResp = tareas.filter((t) => t.estado !== 'hecha' && !claveResp(t) && (S.area === 'all' || t.area === S.area)).length;
    const tile = (k, num, etiqueta, mal) => h('button', { type: 'button', class: `ac-tile${S.spec === k ? ' on' : ''}${mal && num ? ' mal' : ''}`, onclick: () => { S.spec = S.spec === k ? null : k; pintar(); } }, h('b', {}, num), h('span', {}, etiqueta));
    clear(tiles, tile('venc', n((g) => g === 'venc'), 'Vencidas', true), tile('hoy', n((g) => g === 'hoy'), 'Para hoy'), tile('sem', n((g) => g === 'hoy' || g === 'sem'), 'Próximos 7 días'), tile('nadie', sinResp, 'Sin responsable'));
    const claves = new Map();
    tareas.forEach((t) => { const c = claveResp(t); if (c) claves.set(c, nombreResp(t)); });
    clear(barraResp, [['todas', 'Todas'], ['mias', 'Mías'], ...[...claves.entries()].filter(([c]) => c !== yo.id).sort((a, b) => a[1].localeCompare(b[1])), ['nadie', 'Sin asignar']].map(([k, l]) =>
      h('button', { class: 'seg-btn', type: 'button', 'aria-selected': String(S.quien === k), onclick: () => { S.quien = k; pintar(); } }, l)));
    document.querySelectorAll('.ac-chip').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.area === S.area)));
    document.querySelectorAll('.ac-vista .seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === S.vista)));
  }

  const chips = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Área' }, ['all', ...areasPropias].map((a) =>
    h('button', { class: 'seg-btn ac-chip', type: 'button', dataset: { area: a }, onclick: () => { S.area = a; pintar(); } }, a === 'all' ? 'Todas las áreas' : AREAS[a])));
  const vista = h('div', { class: 'segmented ac-vista', role: 'group', 'aria-label': 'Vista' }, [['lista', 'Lista'], ['tablero', 'Tablero']].map(([k, l]) =>
    h('button', { class: 'seg-btn', type: 'button', dataset: { v: k }, onclick: () => { S.vista = k; pintar(); } }, l)));
  const ayuda = leyenda(areasPropias);
  ayuda.hidden = !ayudaAbierta();
  const btnAyuda = h('button', { class: 'btn small', type: 'button', 'aria-expanded': String(!ayuda.hidden), onclick: () => { ayuda.hidden = !ayuda.hidden; btnAyuda.setAttribute('aria-expanded', String(!ayuda.hidden)); guardarAyuda(!ayuda.hidden); } }, '? Cómo funciona');

  clear(view, cabecera('Tareas', `${tareas.filter((t) => t.estado !== 'hecha').length} pendientes`, btnAyuda, editor ? h('button', { class: 'btn small', type: 'button', onclick: () => abrir(null, { uPor, ctx, recargar, areasPropias, nombreResp }) }, '+ Tarea con detalle') : null),
    ayuda, tiles,
    h('div', { class: 'ac-nueva' }, nueva, nuevaArea),
    h('div', { class: 'ac-filtros' }, barraResp, chips, h('input', { type: 'search', placeholder: 'Buscar…', 'aria-label': 'Buscar tareas', value: S.q, oninput: (e) => { S.q = e.target.value; pintar(); } }),
      h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: S.hechas, onchange: (e) => { S.hechas = e.target.checked; pintar(); } }), ' Ver hechas'), vista),
    cont);
  pintar();
}

function leyenda(areasPropias) {
  const p = (t, d) => h('li', {}, h('b', {}, t + ' '), d);
  return h('div', { class: 'card ac-ayuda' },
    h('h3', { class: 'sub-titulo' }, 'Cómo funciona'),
    h('ul', { class: 'small' },
      p('Crear.', 'Escribe en la barra, elige el área y pulsa Intro: queda asignada a ti. «+ Tarea con detalle» permite poner fecha, responsable, lista de comprobación y más.'),
      p('Áreas.', 'Académica (alumnos, grupos, tutorías, eventos), Centro (mantenimiento, material, organización), Contabilidad (royalties, facturas, cobros) y Domiciliaciones y pagos (altas y bajas en domiciliaciones, cambios de cuota o de cuenta, recibos, devoluciones).'),
      p('Quién ve qué.', areasPropias.some((a) => AREAS_DINERO.includes(a)) ? 'Contabilidad y Domiciliaciones y pagos solo las ven las personas con permiso de dinero; quien no lo tiene no las ve ni se le pueden asignar.' : 'Tu usuario no tiene permiso de dinero, por eso no ves las áreas Contabilidad ni Domiciliaciones y pagos.'),
      p('Cambios en domiciliaciones y pagos.', 'Apunta aquí cada cambio antes de generar la remesa (alta, baja, cuota nueva, cuenta nueva, pago por Visa o transferencia). Márcalo como hecha cuando esté aplicado en Pagos/Remesas. No escribas IBAN: están en la ficha del alumno.'),
      p('Estados.', 'Pendiente → En curso → Hecha. En Tablero se arrastra la tarjeta de una columna a otra.'),
      p('Fechas.', 'En rojo, vencida; «Hoy» y los contadores de arriba (clic para filtrar) ayudan a ver lo urgente. La franja de color a la izquierda indica prioridad: ámbar importante, rojo urgente.'),
      p('Se repite.', 'Si una tarea es semanal o mensual, al marcarla como hecha se crea sola la siguiente.'),
      p('Responsable.', 'Elige un usuario o escribe un nombre si aún no tiene acceso. «Mías» filtra lo tuyo; «Sin asignar» enseña lo que nadie lleva.'),
      p('Comentarios.', 'Dentro de cada tarea puedes comentar; los cambios de estado quedan registrados.'),
      p('Etiqueta «Keep: …».', 'Tareas importadas de Google Keep: la etiqueta indica de qué nota venían.')));
}

function abrir(t, { uPor, ctx, recargar, areasPropias, nombreResp }) {
  const yo = ctx.state.perfil;
  const d = drawer({ titulo: t ? 'Editar tarea' : 'Nueva tarea', ancho: 540 });
  let items = (t?.items || []).map((x) => ({ ...x }));
  const usuarios = [...uPor.values()];
  const F = { titulo: txt(t?.titulo), notas: area(t?.notas), vence: fecha(t?.vence), prio: sel(PRIO.map((p, i) => [String(i), p]), String(t?.prioridad ?? 0)),
    etiqueta: txt(t?.etiqueta, { placeholder: 'Matrícula, Pagos, Material…' }), area: sel(areasPropias.map((a) => [a, AREAS[a]]), t?.area || areasPropias[0]),
    estado: sel(Object.entries(ESTADOS), t?.estado || 'pend'), repite: sel([['', 'No se repite'], ['semanal', 'Cada semana'], ['mensual', 'Cada mes']], t?.repite || ''),
    asig: sel(usuarios.map((u) => [u.id, u.nombre || u.email]), t?.asignado_a, { vacio: 'Sin usuario' }), resp: txt(t?.responsable, { placeholder: 'Nombre, si aún no tiene usuario' }) };
  const caja = h('div');
  const pintarItems = () => clear(caja, items.map((it, i) => h('div', { class: 'ac-fila' }, h('input', { type: 'checkbox', checked: it.ok, onchange: (e) => { it.ok = e.target.checked; } }),
    h('input', { type: 'text', value: it.t, style: 'flex:1', onchange: (e) => { it.t = e.target.value; } }), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { items.splice(i, 1); pintarItems(); } }, '✕'))),
    h('button', { class: 'btn small', type: 'button', onclick: () => { items.push({ t: '', ok: false }); pintarItems(); } }, '+ Elemento'));
  pintarItems();
  const com = h('div');
  const pintarCom = () => clear(com, [...(t?.comentarios || [])].reverse().map((c) => h('div', { class: 'small' + (c.sys ? ' muted' : ''), style: 'padding:4px 0;border-top:1px solid var(--border)' },
    c.sys ? '' : h('b', {}, `${uPor.get(c.by)?.nombre || 'Alguien'}: `), c.t, h('span', { class: 'muted' }, ' · ' + fmtFecha(String(c.at).slice(0, 10))))));
  pintarCom();
  const nuevoCom = txt('', { placeholder: 'Escribe un comentario y pulsa Intro' });
  nuevoCom.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !nuevoCom.value.trim() || !t) return;
    try { t.comentarios = [...(t.comentarios || []), { by: yo.id, t: nuevoCom.value.trim(), at: new Date().toISOString() }]; Object.assign(t, await api.upd('ac_tareas', t.id, { comentarios: t.comentarios })); nuevoCom.value = ''; pintarCom(); } catch (ex) { toast(ex.message, 'error'); }
  });
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Título', F.titulo, { full: true, req: true }), campo('Área', F.area), campo('Estado', F.estado), campo('Responsable (usuario)', F.asig), campo('Responsable (nombre)', F.resp),
    campo('Fecha límite', F.vence), campo('Prioridad', F.prio), campo('Se repite', F.repite), campo('Etiqueta', F.etiqueta), campo('Notas', F.notas, { full: true }),
    h('div', { class: 'full' }, h('div', { class: 'small', style: 'font-weight:600;margin-bottom:4px' }, 'Lista de comprobación'), caja),
    t ? h('div', { class: 'full' }, h('div', { class: 'small', style: 'font-weight:600;margin-bottom:4px' }, 'Comentarios e historial'), nuevoCom, com) : null));
  const guardar = guardarBoton('Guardar', async () => {
    if (!F.titulo.value.trim()) { toast('Falta el título.', 'error'); return; }
    const fila = { titulo: F.titulo.value.trim(), notas: F.notas.value.trim() || null, vence: F.vence.value || null, prioridad: Number(F.prio.value), etiqueta: F.etiqueta.value.trim() || null,
      asignado_a: F.asig.value || null, responsable: F.resp.value.trim() || null, area: F.area.value, estado: F.estado.value, repite: F.repite.value || null, items: items.filter((x) => x.t.trim()) };
    try {
      if (t) {
        if (t.estado !== fila.estado) fila.comentarios = [...(t.comentarios || []), { sys: true, t: `${yo.nombre || yo.email} pasó la tarea a «${ESTADOS[fila.estado]}»`, at: new Date().toISOString() }];
        await api.upd('ac_tareas', t.id, fila);
      } else await api.ins('ac_tareas', { ...fila, asignado_a: fila.asignado_a || (fila.responsable ? null : yo.id) });
      toast('Tarea guardada'); d.cerrar(); recargar();
    } catch (ex) { toast(ex.message, 'error'); }
  });
  guardar.disabled = !ctx.puedeEditar();
  const borrar = t && ctx.puedeEditar() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar tarea', texto: t.titulo, ok: 'Borrar', peligro: true })) { try { await api.del('ac_tareas', t.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, guardar);
}
