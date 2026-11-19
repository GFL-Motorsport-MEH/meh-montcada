// TRABAJADORES · Documentos: cada usuario ve solo SUS documentos (nóminas, contratos, certificados…). Quien gestiona el portal
// (permiso «Portal del trabajador» con alcance «todo» y edición) elige a un trabajador y le sube o quita documentos.
// Los archivos van a un bucket privado de Supabase y se abren con un enlace firmado temporal; la base de datos aplica la misma regla.
import { h, clear, cargando, toast, confirmar, fmtFecha } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, tabla, cabecera, refrescar } from '../academia/kit.js';

const TIPOS = [['nomina', 'Nómina'], ['contrato', 'Contrato'], ['certificado', 'Certificado'], ['otro', 'Otro']];
const NOM_TIPO = Object.fromEntries(TIPOS);
let verTrabajador = '';

export async function abrir(ruta) {
  const w = window.open('', '_blank');
  try { const url = await api.urlPortal(ruta); if (w) { w.opener = null; w.location.href = url; } else window.location.href = url; } catch (ex) { w?.close(); toast('No se ha podido abrir: ' + ex.message, 'error'); }
}

export async function renderDocumentos(view, ctx) {
  clear(view, cargando());
  const yo = ctx.state.perfil;
  const gestiona = ctx.ve('ac_portal') && ctx.edita('ac_portal');
  const veTodos = ctx.ve('ac_portal');
  const [docs, equipo] = await Promise.all([api.portalDocs(), veTodos ? api.usuarios().catch(() => []) : Promise.resolve([])]);
  const nombreDe = new Map([...equipo, yo].filter(Boolean).map((u) => [u.id, u.nombre || u.email || '—']));
  const recargar = () => { refrescar(); };

  const cols = (conQuitar, conPersona) => [
    ...(conPersona ? [{ t: 'Trabajador', v: (d) => nombreDe.get(d.profile_id) || '—' }] : []),
    { t: 'Tipo', v: (d) => NOM_TIPO[d.tipo] || d.tipo }, { t: 'Documento', v: (d) => h('strong', {}, d.titulo) }, { t: 'Periodo', v: (d) => d.periodo || '' },
    { t: 'Subido', s: (d) => d.created_at || '', v: (d) => fmtFecha((d.created_at || '').slice(0, 10)) },
    { t: '', sin: true, v: (d) => h('button', { class: 'btn small', type: 'button', onclick: (e) => { e.stopPropagation(); abrir(d.ruta); } }, 'Abrir') },
    ...(conQuitar ? [{ t: '', sin: true, v: (d) => h('button', { class: 'btn small ghost', type: 'button', onclick: async (e) => {
      e.stopPropagation();
      if (!await confirmar({ titulo: 'Quitar documento', texto: `Se quitará «${d.titulo}» del portal de ${nombreDe.get(d.profile_id) || 'este trabajador'}.`, ok: 'Quitar', peligro: true })) return;
      try { await api.delDocumento(d); toast('Documento quitado'); recargar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') }] : []),
  ];

  const mios = docs.filter((d) => d.profile_id === yo.id);
  const secMios = h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, 'Mis documentos'),
    tabla(cols(false, false), mios, { vacio: 'Todavía no tienes documentos en tu portal.' }));
  const partes = [cabecera('Documentos', `Hola, ${yo.nombre || yo.email}. Aquí tienes tus nóminas, contratos y certificados; solo los ves tú.`), secMios];

  if (veTodos) {
    const personas = equipo.filter((u) => u.activo !== false).sort((a, b) => (a.nombre || a.email || '').localeCompare(b.nombre || b.email || '', 'es'));
    const filtro = sel([['', 'Todos los trabajadores'], ...personas.map((u) => [u.id, u.nombre || u.email])], verTrabajador, { onchange: (e) => { verTrabajador = e.target.value; pintarTodos(); }, 'aria-label': 'Trabajador' });
    const cont = h('div');
    const pintarTodos = () => clear(cont, tabla(cols(gestiona, true), docs.filter((d) => !verTrabajador || d.profile_id === verTrabajador), { vacio: 'No hay documentos subidos.' }));
    const alta = gestiona ? (() => {
      const F = { quien: sel(personas.map((u) => [u.id, u.nombre || u.email]), verTrabajador || '', { vacio: 'Elige trabajador…' }), tipo: sel(TIPOS, 'nomina'), titulo: txt('', { placeholder: 'Nómina de noviembre' }), periodo: txt('', { placeholder: '2026-11' }),
        archivo: h('input', { type: 'file', accept: 'application/pdf,image/*', 'aria-label': 'Archivo' }) };
      const subir = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const f = F.archivo.files[0];
        if (!F.quien.value || !F.titulo.value.trim() || !f) { toast('Elige trabajador, escribe un título y selecciona el archivo.', 'error'); return; }
        if (f.size > 20 * 1024 * 1024) { toast('El archivo pasa de 20 MB.', 'error'); return; }
        subir.disabled = true; let ruta = null;
        try {
          ruta = await api.subirPortal(F.quien.value, f);
          await api.insDocumento({ profile_id: F.quien.value, tipo: F.tipo.value, titulo: F.titulo.value.trim(), periodo: F.periodo.value.trim() || null, ruta, nombre_archivo: f.name });
          toast('Documento subido'); recargar();
        } catch (ex) { if (ruta) api.quitarArchivoPortal(ruta); toast('No se ha subido: ' + ex.message, 'error'); subir.disabled = false; }
      } }, 'Subir documento');
      return h('div', { class: 'form-section' }, h('h3', {}, 'Subir un documento'), campo('Trabajador', F.quien), campo('Tipo', F.tipo), campo('Título', F.titulo), campo('Periodo', F.periodo), campo('Archivo (PDF o imagen)', F.archivo, { full: true }), h('div', { class: 'full' }, subir));
    })() : null;
    partes.push(h('div', { class: 'card' }, h('h3', { class: 'sub-titulo' }, gestiona ? 'Documentos de los trabajadores' : 'Documentos de todos'), h('div', { class: 'filters' }, filtro), cont, alta));
    pintarTodos();
  }
  clear(view, ...partes);
}
