// Formularios públicos (sustituyen a los de Google): la definición vive en ac_formularios, las familias los rellenan en la web
// aparte (carpeta forms/) y aquí el personal ve las respuestas y las procesa. Para añadir un formulario nuevo basta crearlo
// aquí («+ Nuevo formulario»); si necesita un procesado especial (como las tutorías) se añade a PROCESADORES.
import { h, clear, cargando, toast, confirmar, fmtFecha, hoyISO, normalizar } from '../ui.js';
import { FORMULARIOS_URL } from '../config.js';
import * as api from './api.js';
import { campo, area, fecha, sel, drawer, cabecera, tabla, pill, nombreAlumno, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

const TIPOS = ['texto', 'email', 'telefono', 'textarea', 'numero', 'fecha', 'radio', 'select', 'casillas', 'rejilla', 'acepto'];
const ABREV = { Lunes: 'Lun', Martes: 'Mar', 'Miércoles': 'Mié', Jueves: 'Jue', Viernes: 'Vie', 'Sábado': 'Sáb', Domingo: 'Dom' };
const IDX = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
export const urlFormulario = (f) => `${FORMULARIOS_URL}/${f.slug}`;

// ---------- presentación de valores ----------
function resumenRejilla(v) {
  const por = new Map();
  for (const x of v || []) (por.get(x.c) || por.set(x.c, []).get(x.c)).push(x.f);
  return [...por].map(([c, fs]) => `${ABREV[c] || c} ${fs.sort().join(', ')}`).join(' · ');
}
export function textoValor(c, v) {
  if (v === undefined || v === null || v === '') return '';
  if (c.tipo === 'rejilla') return resumenRejilla(v);
  if (Array.isArray(v)) return v.join(', ');
  if (c.tipo === 'acepto') return v ? 'Sí' : 'No';
  if (c.tipo === 'fecha') return fmtFecha(v);
  return String(v);
}

// ---------- coincidencia de alumno por nombre (en cualquier orden); null si no hay coincidencia clara ----------
export function mejorAlumno(texto, alumnos) {
  const q = new Set(normalizar(texto).split(/[\s,]+/).filter((w) => w.length > 1 && w !== 'y' && w !== 'de'));
  if (!q.size) return null;
  let mejor = null; let top = 0; let empate = false;
  for (const a of alumnos) {
    const toks = normalizar(`${a.nombre} ${a.apellidos}`).split(/\s+/).filter((w) => w.length > 1);
    if (!toks.length) continue;
    const comunes = toks.filter((w) => q.has(w)).length;
    const score = comunes / toks.length;
    if (comunes >= 2 && score > top + 1e-9) { top = score; mejor = a; empate = false; } else if (comunes >= 2 && Math.abs(score - top) < 1e-9) empate = true;
  }
  return top >= 0.6 && !empate ? mejor : null;
}
function proximaFecha(dia) {
  const n = IDX[normalizar(dia)]; if (n === undefined) return hoyISO();
  const d = new Date(); d.setHours(12, 0, 0, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== n);
  return d.toISOString().slice(0, 10);
}

// ---------- procesadores por tipo de formulario ----------
// Cada uno aporta un panel en la ficha de la respuesta y devuelve una función que la procesa (o null si no hay nada que crear).
const PROCESADORES = {
  tutoria: {
    panel(r, { alumnos, profes, curso }) {
      const d = r.datos; const sugerido = r.alumno || mejorAlumno(d.alumno, alumnos); const primera = (d.disponibilidad || [])[0];
      const F = { al: buscadorAlumno(alumnos, { valorId: sugerido?.id }), fecha: fecha(primera ? proximaFecha(primera.c) : hoyISO()), hora: h('input', { type: 'time', value: primera?.f || '' }),
        prof: sel(profes.filter((p) => p.activa).map((p) => [p.id, p.nombre]), '', { vacio: '—' }), formato: sel([['presencial', 'Presencial'], ['telefono', 'Teléfono'], ['online', 'Online']], 'presencial'),
        motivo: area([d.tema, d.asiste === 'Sí' ? 'Quieren que asista la profesora.' : ''].filter(Boolean).join('\n')) };
      const nodo = h('div', {}, h('h3', { style: 'font-size:15px;margin:16px 0 6px' }, 'Crear la tutoría'),
        h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Fecha', F.fecha), campo('Hora', F.hora), campo('Profesora', F.prof), campo('Formato', F.formato), campo('Motivo', F.motivo, { full: true })),
        h('div', { class: 'small muted' }, sugerido ? 'Alumno propuesto por coincidencia de nombre: compruébalo.' : 'No se ha encontrado el alumno con claridad: elígelo de la lista.'));
      const procesar = async () => {
        const al = F.al.getAlumno(); if (!al) throw new Error('Elige un alumno de la lista.');
        const tut = await api.ins('ac_tutorias', { alumno_id: al.id, curso_id: curso.id, fecha: F.fecha.value || hoyISO(), hora: F.hora.value || null, profesora_id: F.prof.value || null, formato: F.formato.value, estado: 'pendiente', motivo: F.motivo.value.trim() || null });
        return { alumno_id: al.id, ref_tabla: 'ac_tutorias', ref_id: tut.id };
      };
      return { nodo, procesar, boton: 'Crear tutoría' };
    },
  },
};
const panelGenerico = (r, { alumnos }) => {
  const F = { al: buscadorAlumno(alumnos, { valorId: r.alumno?.id }), notas: area(r.notas) };
  return { nodo: h('div', {}, h('h3', { style: 'font-size:15px;margin:16px 0 6px' }, 'Procesar'), h('div', { class: 'form-section' }, campo('Alumno (opcional)', F.al, { full: true }), campo('Notas', F.notas, { full: true }))),
    procesar: async () => ({ alumno_id: F.al.getAlumno()?.id || null, notas: F.notas.value.trim() || null }), boton: 'Marcar como procesada' };
};

// ---------- vista ----------
export async function renderFormularios(view, ctx) {
  clear(view, cargando());
  const curso = ctx.cursoActual();
  const [forms, alumnos, profes] = await Promise.all([api.formularios(), api.alumnos(), api.profesoras()]);
  const editor = ctx.edita('ac_formularios');
  const recargar = () => { api.invalidar(); refrescar(); };
  if (!forms.length && !editor) { clear(view, cabecera('Formularios', 'Aún no hay formularios.')); return; }
  const respPorForm = new Map(await Promise.all(forms.map(async (f) => [f.id, await api.formRespuestas(f.id)])));
  const nuevas = (f) => (respPorForm.get(f.id) || []).filter((r) => r.estado === 'nueva').length;
  let actual = forms.find((f) => f.id === sessionStorage.getItem('ac_form_sel')) || forms.find((f) => nuevas(f)) || forms[0];
  const st = { estado: 'nueva' };
  const cont = h('div');

  function pintar() {
    if (!actual) { clear(cont, h('p', { class: 'muted' }, 'Crea el primer formulario con «+ Nuevo formulario».')); return; }
    const resp = (respPorForm.get(actual.id) || []).filter((r) => !st.estado || r.estado === st.estado).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const mostrados = actual.campos.filter((c) => c.tipo !== 'acepto').slice(0, 5);
    clear(cont, tabla([
      { t: 'Recibida', v: (r) => fmtFecha(r.created_at.slice(0, 10)) },
      ...mostrados.map((c) => ({ t: c.etiqueta.replace(/[:?¿]/g, '').slice(0, 28), v: (r) => textoValor(c, r.datos?.[c.id]) })),
      { t: 'Estado', v: (r) => pill(r.estado, r.estado === 'procesada' ? 'ok' : r.estado === 'descartada' ? 'off' : 'warn') },
    ], resp, { onClick: (r) => abrir(r, { form: actual, alumnos, profes, curso, recargar, editor }), vacio: 'No hay respuestas con este filtro.' }));
  }
  const selForm = sel(forms.map((f) => [f.id, `${f.titulo}${nuevas(f) ? ` (${nuevas(f)} nuevas)` : ''}${f.activo ? '' : ' · desactivado'}`]), actual?.id, { onchange: (e) => { actual = forms.find((f) => f.id === e.target.value); sessionStorage.setItem('ac_form_sel', actual.id); pintar(); } });
  const selEstado = sel([['', 'Todas'], ['nueva', 'Nuevas'], ['procesada', 'Procesadas'], ['descartada', 'Descartadas']], st.estado, { onchange: (e) => { st.estado = e.target.value; pintar(); } });
  const copiar = async () => { if (!actual) return; const u = urlFormulario(actual); try { await navigator.clipboard.writeText(u); toast('Enlace copiado: ' + u); } catch { window.prompt('Copia este enlace:', u); } };
  clear(view, cabecera('Formularios', 'Lo que rellenan las familias en la web de formularios, para revisar y procesar',
    editor ? h('button', { class: 'btn small', type: 'button', onclick: () => editarForm(null, { recargar }) }, '+ Nuevo formulario') : null,
    editor ? h('button', { class: 'btn small', type: 'button', onclick: () => actual && editarForm(actual, { recargar }) }, 'Editar formulario') : null,
    editor ? h('button', { class: 'btn small', type: 'button', onclick: () => actual && importar(actual, { respuestas: respPorForm.get(actual.id) || [], recargar }) }, 'Importar de Google') : null,
    h('button', { class: 'btn primary small', type: 'button', onclick: copiar }, 'Copiar enlace para familias')),
    h('div', { class: 'filters filters-2' }, selForm, selEstado), cont);
  pintar();
}

// ---------- ficha de una respuesta ----------
function abrir(r, { form, alumnos, profes, curso, recargar, editor }) {
  const d = drawer({ titulo: `${form.titulo} · ${fmtFecha(r.created_at.slice(0, 10))}`, ancho: 620 });
  d.cuerpo.append(h('div', { class: 'form-section' }, form.campos.filter((c) => c.tipo !== 'acepto' || r.datos?.[c.id]).map((c) => campo(c.etiqueta, h('div', { style: 'white-space:pre-wrap' }, textoValor(c, r.datos?.[c.id]) || '—'), { full: ['textarea', 'rejilla'].includes(c.tipo) || String(textoValor(c, r.datos?.[c.id])).length > 40 }))));
  const act = (estado) => async () => { try { await api.upd('ac_formulario_respuestas', r.id, { estado }); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } };
  if (r.estado === 'nueva' && editor) {
    const p = (PROCESADORES[form.tipo]?.panel || panelGenerico)(r, { alumnos, profes, curso });
    d.cuerpo.append(p.nodo);
    const hecho = guardarBoton(p.boton, async () => {
      try { const extra = await p.procesar(); await api.upd('ac_formulario_respuestas', r.id, { estado: 'procesada', ...extra }); toast('Procesada'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
    });
    d.pie.append(h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Descartar respuesta', texto: 'Quedará como descartada (se puede recuperar).', ok: 'Descartar' })) act('descartada')(); } }, 'Descartar'), hecho);
  } else if (editor && r.estado !== 'nueva') {
    if (r.notas) d.cuerpo.append(h('div', { class: 'small muted', style: 'margin-top:10px' }, 'Notas: ' + r.notas));
    d.pie.append(h('span', { class: 'small muted' }, r.estado === 'procesada' ? (r.alumno ? `Procesada · ${nombreAlumno(r.alumno)}` : 'Procesada') : 'Descartada'), h('button', { class: 'btn', type: 'button', onclick: act('nueva') }, 'Volver a nuevas'));
  } else d.pie.append(h('span'));
}

// ---------- crear / editar la definición de un formulario ----------
function editarForm(f, { recargar }) {
  const d = drawer({ titulo: f ? `Editar · ${f.titulo}` : 'Nuevo formulario', ancho: 680 });
  const ejemplo = [{ id: 'nombre', tipo: 'texto', etiqueta: 'Nombre completo', requerido: true }, { id: 'curso', tipo: 'select', etiqueta: 'Curso', opciones: ['Kids', 'Teens', 'Adultos'] }];
  const F = { titulo: h('input', { type: 'text', value: f?.titulo || '' }), slug: h('input', { type: 'text', value: f?.slug || '', disabled: !!f, placeholder: 'ej. autorizacion-salida' }),
    desc: area(f?.descripcion), fin: area(f?.mensaje_final), tipo: sel([['generico', 'Genérico (notas y alumno)'], ['tutoria', 'Tutoría (crea la tutoría)']], f?.tipo || 'generico', { disabled: !!f }),
    activo: h('input', { type: 'checkbox', checked: f ? f.activo : true }), campos: h('textarea', { rows: 16, style: 'font-family:monospace;font-size:12px', spellcheck: 'false' }, JSON.stringify(f?.campos || ejemplo, null, 2)) };
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Título', F.titulo, { full: true, req: true }), campo('Dirección (solo minúsculas, números y guiones)', F.slug, { req: true }), campo('Tipo de procesado', F.tipo), campo('Activo (las familias pueden rellenarlo)', F.activo),
    campo('Texto bajo el título', F.desc, { full: true }), campo('Mensaje al enviar', F.fin, { full: true }), campo('Campos (JSON)', F.campos, { full: true })),
    h('div', { class: 'small muted' }, `Cada campo: id (único), tipo (${TIPOS.join(', ')}), etiqueta, requerido, ayuda, opciones (radio/select/casillas), filas y columnas (rejilla), google (trozos del encabezado del Excel de Google, para importar respuestas antiguas). `, 'Cambiar o quitar campos no borra las respuestas ya recibidas.'));
  const guardar = guardarBoton('Guardar', async () => {
    let campos;
    try { campos = JSON.parse(F.campos.value); } catch { toast('Los campos no son un JSON válido.', 'error'); return; }
    const ids = new Set();
    if (!Array.isArray(campos) || !campos.length || campos.some((c) => !c.id || !/^[a-z0-9_]+$/.test(c.id) || ids.has(c.id) || !ids.add(c.id) || !TIPOS.includes(c.tipo) || !c.etiqueta)) { toast('Cada campo necesita id único (a-z, 0-9, _), tipo válido y etiqueta.', 'error'); return; }
    if (campos.some((c) => ['radio', 'select', 'casillas'].includes(c.tipo) && !(c.opciones || []).length) || campos.some((c) => c.tipo === 'rejilla' && (!(c.filas || []).length || !(c.columnas || []).length))) { toast('Faltan opciones (radio/select/casillas) o filas y columnas (rejilla).', 'error'); return; }
    const slug = F.slug.value.trim();
    if (!F.titulo.value.trim() || !/^[a-z0-9-]{2,40}$/.test(slug)) { toast('Pon un título y una dirección válida (2–40: minúsculas, números, guiones).', 'error'); return; }
    const fila = { titulo: F.titulo.value.trim(), descripcion: F.desc.value.trim() || null, mensaje_final: F.fin.value.trim() || null, activo: F.activo.checked, campos };
    try { if (f) await api.upd('ac_formularios', f.id, fila); else { const nuevo = await api.ins('ac_formularios', { ...fila, slug, tipo: F.tipo.value }); sessionStorage.setItem('ac_form_sel', nuevo.id); } toast('Formulario guardado'); d.cerrar(); recargar(); } catch (ex) { toast('No se ha guardado: ' + ex.message, 'error'); }
  });
  const borrar = f ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar formulario', texto: `Se borrarán también TODAS sus respuestas. Si solo quieres que deje de funcionar, desmarca «Activo».`, ok: 'Borrar todo', peligro: true })) { try { await api.del('ac_formularios', f.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, guardar);
}

// ---------- importar el Excel de respuestas de Google (no duplica: la clave es fecha + correo) ----------
function importar(form, { respuestas, recargar }) {
  const hoy = new Date(); const corte0 = `${hoy.getMonth() >= 8 ? hoy.getFullYear() : hoy.getFullYear() - 1}-09-01`;
  const d = drawer({ titulo: `Importar respuestas · ${form.titulo}`, ancho: 520 });
  const inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' }); const corte = fecha(corte0); const info = h('div', { class: 'small muted' });
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Excel de respuestas de Google', inp, { full: true }), campo('Marcar como procesadas las anteriores a', corte, { full: true })), info);
  let nuevas = [];
  inp.onchange = async () => {
    nuevas = []; const file = inp.files[0]; if (!file) return;
    try {
      const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      const cab = (filas[0] || []).map((x) => normalizar(String(x ?? '')));
      const iF = cab.findIndex((c) => /marca temporal/.test(c)); const iE = cab.findIndex((c) => /correo/.test(c));
      if (iF < 0) throw new Error('No encuentro la columna «Marca temporal»: ¿es el Excel de respuestas de un formulario de Google?');
      const cols = form.campos.map((c) => {
        const pistas = (c.google || []).map(normalizar);
        const idx = cab.map((x, i) => [i, x]).filter(([, x]) => pistas.some((p) => x.includes(p)));
        return { c, idx };
      });
      if (!cols.some((x) => x.idx.length)) throw new Error('Los encabezados del Excel no coinciden con los campos de este formulario (campo «google» de cada campo).');
      const existentes = new Set(respuestas.map((r) => r.origen_ref).filter(Boolean));
      for (const r of filas.slice(1)) {
        const fh = r[iF] instanceof Date ? r[iF] : null; if (!fh) continue;
        const iso = fh.toISOString(); const ref = `google:${iso}|${String(iE >= 0 ? r[iE] || '' : '').toLowerCase()}`;
        if (existentes.has(ref)) continue;
        const datos = {};
        for (const { c, idx } of cols) {
          if (!idx.length) continue;
          const crudo = (i) => (r[i] == null ? '' : String(r[i]).trim());
          if (c.tipo === 'rejilla') {
            const v = [];
            for (const [i, x] of idx) {
              const fila = (c.filas || []).find((ff) => normalizar(ff) === normalizar((x.match(/\[([^\]]+)\]/)?.[1] || '').replace(/\s*h$/i, '')) || normalizar(ff).replace(/^0/, '') === normalizar((x.match(/\[([^\]]+)\]/)?.[1] || '').replace(/\s*h$/i, '')).replace(/^0/, ''));
              if (!fila) continue;
              for (const parte of crudo(i).split(/[,;]/).map((s) => normalizar(s.trim())).filter(Boolean)) { const col = (c.columnas || []).find((cc) => normalizar(cc) === parte); if (col) v.push({ c: col, f: fila }); }
            }
            if (v.length) datos[c.id] = v;
          } else if (c.tipo === 'casillas') {
            const v = crudo(idx[0][0]).split(/[,;]/).map((s) => (c.opciones || []).find((o) => normalizar(o) === normalizar(s.trim()))).filter(Boolean); if (v.length) datos[c.id] = v;
          } else if (c.tipo === 'radio' || c.tipo === 'select') {
            const o = (c.opciones || []).find((x) => normalizar(x) === normalizar(crudo(idx[0][0]))); if (o) datos[c.id] = o;
          } else if (c.tipo === 'acepto') { datos[c.id] = /^(s|true|1|x)/i.test(crudo(idx[0][0])); } else { const v = crudo(idx[0][0]); if (v) datos[c.id] = v; }
        }
        nuevas.push({ formulario_id: form.id, created_at: iso, datos, origen: 'google', origen_ref: ref });
      }
      info.textContent = nuevas.length ? `${nuevas.length} respuestas nuevas para importar (las que ya estaban se omiten).` : 'No hay respuestas nuevas que importar.';
    } catch (ex) { info.textContent = ''; toast(ex.message, 'error'); }
  };
  const ir = guardarBoton('Importar', async () => {
    if (!nuevas.length) { toast('Elige primero el Excel (con respuestas nuevas).', 'error'); return; }
    try { await api.insMany('ac_formulario_respuestas', nuevas.map((n) => ({ ...n, estado: n.created_at.slice(0, 10) < corte.value ? 'procesada' : 'nueva' }))); toast(`${nuevas.length} respuestas importadas`); d.cerrar(); recargar(); } catch (ex) { toast('No se ha importado: ' + ex.message, 'error'); }
  });
  d.pie.append(h('span'), ir);
}
