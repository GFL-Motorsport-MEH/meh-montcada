// ALUMNOS · Comunicaciones con la familia: registro de lo que el centro envía y de lo que llega (portal, correo, teléfono…).
// Con el portal, los mensajes «de la familia» entrarán aquí solos; mientras tanto se apuntan a mano.
import { h, clear, cargando, toast, confirmar } from '../ui.js';
import * as api from './api.js';
import { campo, sel, txt, area, drawer, cabecera, tabla, guardarBoton, buscadorAlumno, nombreAlumno, refrescar, pill } from '../academia/kit.js';
import { CANALES, familiaPill, filtroAlumno, casillaFamilia } from './util.js';

const SENTIDOS = [['a_familia', 'Del centro a la familia'], ['de_familia', 'De la familia al centro']];

export async function renderComunicaciones(view, ctx) {
  clear(view, cargando());
  const [alumnos, msgs] = await Promise.all([api.alumnos(), api.mensajes()]);
  const editor = ctx.edita('al_comunicaciones');
  const porId = new Map(alumnos.map((a) => [a.id, a]));
  let sentido = ''; let soloNoLeidos = false;
  const cont = h('div');
  const fa = filtroAlumno(alumnos, () => pintar());
  const selS = sel([['', 'Todos'], ...SENTIDOS], '', { onchange: (e) => { sentido = e.target.value; pintar(); }, 'aria-label': 'Sentido' });
  const chk = h('input', { type: 'checkbox', onchange: (e) => { soloNoLeidos = e.target.checked; pintar(); } });
  const sinLeer = msgs.filter((m) => m.sentido === 'de_familia' && !m.leido_at).length;

  function pintar() {
    const idA = fa.get();
    const lista = msgs.filter((m) => (!idA || m.alumno_id === idA) && (!sentido || m.sentido === sentido) && (!soloNoLeidos || (m.sentido === 'de_familia' && !m.leido_at)));
    clear(cont, tabla([
      { t: 'Fecha', s: (m) => m.created_at, v: (m) => new Date(m.created_at).toLocaleDateString('es-ES') },
      { t: 'Alumno', v: (m) => h('strong', {}, nombreAlumno(porId.get(m.alumno_id))), s: (m) => nombreAlumno(porId.get(m.alumno_id)) },
      { t: 'Sentido', v: (m) => (m.sentido === 'a_familia' ? '→ A la familia' : '← De la familia'), s: (m) => m.sentido },
      { t: 'Canal', v: (m) => CANALES.find(([k]) => k === m.canal)?.[1] || m.canal },
      { t: 'Asunto', v: (m) => m.asunto },
      { t: 'Leído', v: (m) => (m.sentido === 'de_familia' ? (m.leido_at ? pill('leído', 'ok') : pill('sin leer', 'warn')) : ''), s: (m) => (m.sentido === 'de_familia' ? (m.leido_at ? 'leído' : 'sin leer') : '') },
      { t: 'Familia', v: (m) => familiaPill(m.visible_familia), s: (m) => (m.visible_familia ? 'visible' : 'interno') },
    ], lista, { onClick: (m) => abrir(m), vacio: 'No hay comunicaciones con este filtro.' }));
  }

  function abrir(m) {
    const a0 = m ? porId.get(m.alumno_id) : null;
    const resp = a0?.responsable;
    const d = drawer({ titulo: m ? `${m.asunto}` : 'Nueva comunicación', ancho: 560 });
    const F = { al: buscadorAlumno(alumnos, { valorId: m?.alumno_id, soloActivos: !m }), sentido: sel(SENTIDOS, m?.sentido || 'a_familia'), canal: sel(CANALES, m?.canal || 'portal'), asunto: txt(m?.asunto, { placeholder: 'Recordatorio de la excursión' }),
      texto: area(m?.texto, { rows: 8 }), fam: casillaFamilia(m ? m.visible_familia : true, 'Visible para la familia en el portal') };
    const contacto = resp && (resp.email || resp.telefono) ? h('div', { class: 'small muted' }, 'Contacto: ', `${resp.nombre || ''} ${resp.apellidos || ''}`.trim(), resp.email ? [' · ', h('a', { href: `mailto:${resp.email}` }, resp.email)] : null, resp.telefono ? ` · ${resp.telefono}` : null) : null;
    d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', F.al, { full: true, req: true }), campo('Sentido', F.sentido), campo('Canal', F.canal), campo('Asunto', F.asunto, { full: true, req: true }), campo('Mensaje', F.texto, { full: true }), h('div', { class: 'full' }, F.fam)), contacto);
    const leer = m && m.sentido === 'de_familia' && !m.leido_at ? h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api.upd('al_mensajes', m.id, { leido_at: new Date().toISOString() }); toast('Marcado como leído'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); } } }, 'Marcar como leído') : null;
    d.pie.append(m && editor ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!await confirmar({ titulo: 'Quitar comunicación', texto: `Se quitará «${m.asunto}».`, ok: 'Quitar', peligro: true })) return;
      try { await api.del('al_mensajes', m.id); toast('Quitada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Quitar') : null, leer, editor ? guardarBoton('Guardar', async () => {
      const a = F.al.getAlumno() || a0;
      if (!a) { toast('Elige un alumno de la lista.', 'error'); return; }
      if (!F.asunto.value.trim()) { toast('Pon un asunto.', 'error'); return; }
      const fila = { alumno_id: a.id, sentido: F.sentido.value, canal: F.canal.value, asunto: F.asunto.value.trim(), texto: F.texto.value.trim() || null, visible_familia: F.fam.input.checked };
      try { if (m) await api.upd('al_mensajes', m.id, fila); else await api.ins('al_mensajes', fila); toast('Guardada'); d.cerrar(); refrescar(); } catch (ex) { toast(ex.message, 'error'); }
    }) : null);
  }

  clear(view, cabecera('Comunicaciones', 'Mensajes y contactos con las familias', editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => abrir(null) }, '+ Nueva comunicación') : null),
    sinLeer ? h('div', { class: 'banner warn' }, `Hay ${sinLeer} mensaje${sinLeer === 1 ? '' : 's'} de familias sin leer.`) : null,
    h('div', { class: 'filters filters-3' }, fa.el, selS, h('label', { class: 'al-check' }, chk, ' Solo sin leer')), cont);
  pintar();
}
