// ALUMNOS · Actividades (salidas, talleres, extraescolares…) y quién se ha apuntado.
// Cada actividad puede llevar un formulario (pestaña Formularios de Academia): las respuestas ya asociadas a un alumno se importan como «apuntados»,
// y la familia verá en su portal que su hijo/a está apuntado/a.
import { h, clear, cargando, toast, confirmar, fmtEUR2 } from '../ui.js';
import { FORMULARIOS_URL } from '../config.js';
import * as api from './api.js';
import { campo, sel, txt, area, fecha, numero, drawer, cabecera, tabla, guardarBoton, buscadorAlumno, nombreAlumno, refrescar, pill } from '../academia/kit.js';
import { esActivo } from './util.js';

const ESTADOS = [['apuntado', 'Apuntado'], ['lista_espera', 'Lista de espera'], ['cancelado', 'Cancelado']];

export async function renderActividades(view, ctx) {
  clear(view, cargando());
  const [alumnos, acts, ins, formularios] = await Promise.all([api.alumnos(), api.actividades(), api.inscritos(), api.formularios().catch(() => [])]);
  const editor = ctx.edita('al_actividades');
  const porId = new Map(alumnos.map((a) => [a.id, a]));
  const apuntados = (id) => ins.filter((x) => x.actividad_id === id && x.estado === 'apuntado').length;
  let soloActivas = true;
  const cont = h('div');
  const chk = h('input', { type: 'checkbox', checked: true, onchange: (e) => { soloActivas = e.target.checked; pintar(); } });

  function pintar() {
    clear(cont, tabla([
      { t: 'Actividad', v: (a) => h('strong', {}, a.nombre), s: (a) => a.nombre },
      { t: 'Fecha', s: (a) => a.fecha || '', v: (a) => (a.fecha ? new Date(a.fecha).toLocaleDateString('es-ES') + (a.fecha_fin && a.fecha_fin !== a.fecha ? ` – ${new Date(a.fecha_fin).toLocaleDateString('es-ES')}` : '') : '') },
      { t: 'Lugar', v: (a) => a.lugar || '' },
      { t: 'Precio', num: true, s: (a) => Number(a.precio || 0), v: (a) => (a.precio === null ? '' : fmtEUR2(a.precio)) },
      { t: 'Apuntados', num: true, s: (a) => apuntados(a.id), v: (a) => { const n = apuntados(a.id); return a.plazas ? h('span', {}, `${n} / ${a.plazas}`, n >= a.plazas ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'completa') : null) : String(n); } },
      { t: 'Formulario', v: (a) => formularios.find((f) => f.id === a.formulario_id)?.titulo || '' },
      { t: 'Estado', v: (a) => (a.activa ? pill('abierta', 'ok') : pill('cerrada', 'off')), s: (a) => (a.activa ? 'abierta' : 'cerrada') },
    ], acts.filter((a) => !soloActivas || a.activa), { onClick: (a) => abrir(a), vacio: 'Todavía no hay actividades.' }));
  }

  async function abrir(a) {
    const d = drawer({ titulo: a ? a.nombre : 'Nueva actividad', ancho: 700 });
    const F = { nombre: txt(a?.nombre, { placeholder: 'Salida a la granja' }), desc: area(a?.descripcion), fecha: fecha(a?.fecha), fin: fecha(a?.fecha_fin), lugar: txt(a?.lugar), precio: numero(a?.precio ?? '', { min: 0 }), plazas: h('input', { type: 'number', min: '0', step: '1', value: a?.plazas ?? '' }),
      form: sel(formularios.filter((f) => f.activo || f.id === a?.formulario_id).map((f) => [f.id, f.titulo]), a?.formulario_id, { vacio: '— sin formulario —' }), activa: h('input', { type: 'checkbox', checked: a ? a.activa : true }) };
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Nombre', F.nombre, { full: true, req: true }), campo('Descripción', F.desc, { full: true }), campo('Fecha', F.fecha), campo('Hasta (si dura varios días)', F.fin), campo('Lugar', F.lugar), campo('Precio por alumno (€)', F.precio), campo('Plazas', F.plazas),
      campo('Formulario de inscripción', F.form, { full: true }), h('div', { class: 'full' }, h('label', { class: 'al-check' }, F.activa, ' Abierta (las familias la ven en el portal)'))));
    const bloque = h('div', { class: 'card', style: 'margin-top:12px' });
    d.cuerpo.append(bloque);

    async function pintarApuntados() {
      if (!a) { clear(bloque, h('div', { class: 'muted' }, 'Guarda la actividad para poder apuntar alumnos.')); return; }
      const lista = await api.inscritos({ actividadId: a.id });
      const slug = formularios.find((f) => f.id === a.formulario_id)?.slug;
      const nuevo = buscadorAlumno(alumnos, { soloActivos: true, placeholder: 'Apuntar a un alumno…' });
      clear(bloque, h('h3', { class: 'sub-titulo' }, `Apuntados (${lista.filter((x) => x.estado === 'apuntado').length}${a.plazas ? ' de ' + a.plazas : ''})`),
        h('div', { class: 'al-barra' }, nuevo, editor ? h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const al = nuevo.getAlumno();
          if (!al) { toast('Elige un alumno de la lista.', 'error'); return; }
          if (lista.some((x) => x.alumno_id === al.id)) { toast('Ya está en la lista.', 'error'); return; }
          const lleno = a.plazas && lista.filter((x) => x.estado === 'apuntado').length >= a.plazas;
          try { await api.ins('al_actividad_inscritos', { actividad_id: a.id, alumno_id: al.id, estado: lleno ? 'lista_espera' : 'apuntado' }); toast(lleno ? 'Actividad completa: queda en lista de espera' : 'Apuntado'); ins.push({ actividad_id: a.id, alumno_id: al.id, estado: lleno ? 'lista_espera' : 'apuntado' }); pintarApuntados(); } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Apuntar') : null,
        editor && a.formulario_id ? h('button', { class: 'btn small', type: 'button', onclick: async () => {
          try {
            const resp = (await api.formRespuestas(a.formulario_id)).filter((r) => r.estado !== 'descartada');
            const con = resp.filter((r) => r.alumno_id && porId.has(r.alumno_id));
            const nuevos = con.filter((r) => !lista.some((x) => x.alumno_id === r.alumno_id));
            const unicos = [...new Map(nuevos.map((r) => [r.alumno_id, r])).values()];
            const sin = resp.length - con.length;
            if (unicos.length) {
              let libres = a.plazas ? Math.max(0, a.plazas - lista.filter((x) => x.estado === 'apuntado').length) : Infinity;
              await api.insMany('al_actividad_inscritos', unicos.map((r) => ({ actividad_id: a.id, alumno_id: r.alumno_id, respuesta_id: r.id, estado: libres-- > 0 ? 'apuntado' : 'lista_espera' })));
            }
            toast(`${unicos.length} apuntado${unicos.length === 1 ? '' : 's'} desde el formulario${sin ? ` · ${sin} respuesta${sin === 1 ? '' : 's'} sin alumno asociado (procésalas en Formularios)` : ''}`);
            const nueva = await api.inscritos({ actividadId: a.id }); ins.splice(0, ins.length, ...ins.filter((x) => x.actividad_id !== a.id), ...nueva); pintarApuntados();
          } catch (ex) { toast(ex.message, 'error'); }
        } }, 'Importar apuntados del formulario') : null,
        slug ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { navigator.clipboard?.writeText(`${FORMULARIOS_URL}/${slug}`); toast('Enlace del formulario copiado'); } }, 'Copiar enlace para familias') : null),
        lista.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Alumno', 'Estado', 'Pagado', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, lista.sort((x, y) => nombreAlumno(porId.get(x.alumno_id)).localeCompare(nombreAlumno(porId.get(y.alumno_id)), 'es')).map((x) => h('tr', {},
            h('td', {}, nombreAlumno(porId.get(x.alumno_id))),
            h('td', {}, editor ? sel(ESTADOS, x.estado, { onchange: async (e) => { try { await api.upd('al_actividad_inscritos', x.id, { estado: e.target.value }); x.estado = e.target.value; ins.forEach((i) => { if (i.actividad_id === a.id && i.alumno_id === x.alumno_id) i.estado = x.estado; }); pintarApuntados(); } catch (ex) { toast(ex.message, 'error'); } } }) : ESTADOS.find(([k]) => k === x.estado)?.[1]),
            h('td', {}, h('input', { type: 'checkbox', checked: x.pagado, disabled: !editor, onchange: async (e) => { try { await api.upd('al_actividad_inscritos', x.id, { pagado: e.target.checked }); } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message, 'error'); } } })),
            h('td', {}, editor ? h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { await api.del('al_actividad_inscritos', x.id); const i = ins.findIndex((y) => y.actividad_id === a.id && y.alumno_id === x.alumno_id); if (i >= 0) ins.splice(i, 1); pintarApuntados(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Quitar') : null)))))
          : h('div', { class: 'muted' }, 'Nadie apuntado todavía.'));
    }
    pintarApuntados();

    if (editor) d.pie.append(a ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!await confirmar({ titulo: 'Quitar actividad', texto: `Se quitará «${a.nombre}» y sus apuntados.`, ok: 'Quitar', peligro: true })) return;
      try { await api.delAc('al_actividades', a.id); toast('Actividad quitada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') : null, guardarBoton('Guardar', async () => {
      if (!F.nombre.value.trim()) { toast('Pon un nombre.', 'error'); return; }
      const fila = { nombre: F.nombre.value.trim(), descripcion: F.desc.value.trim() || null, fecha: F.fecha.value || null, fecha_fin: F.fin.value || null, lugar: F.lugar.value.trim() || null,
        precio: String(F.precio.value).trim() === '' ? null : Number(String(F.precio.value).replace(',', '.')), plazas: F.plazas.value === '' ? null : Number(F.plazas.value), formulario_id: F.form.value || null, activa: F.activa.checked };
      try { if (a) await api.updAc('al_actividades', a.id, fila); else await api.insAc('al_actividades', fila); toast('Actividad guardada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    }));
  }

  clear(view, cabecera('Actividades', 'Salidas, talleres y extraescolares con sus apuntados', editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null) }, '+ Nueva actividad') : null),
    h('div', { class: 'filters' }, h('label', { class: 'al-check' }, chk, ' Solo las abiertas')), cont);
  pintar();
}
