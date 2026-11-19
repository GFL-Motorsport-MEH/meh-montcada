// Seguimiento: contactos que aún no son alumnos (captación) y feed de anotaciones de todos los alumnos.
import { h, clear, cargando, toast, confirmar, fmtFecha, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, pill, pillColor, selColor, colorLista, PALETA_LISTAS, nombreAlumno, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

let vista = 'contactos';

export async function renderSeguimiento(view, ctx) {
  clear(view, cargando());
  const [contactos, anotaciones, alumnos, lc] = await Promise.all([api.contactos(), api.anotaciones(), api.alumnos(), api.listasColor()]);
  const ls = { situacion_contacto: lc.situacion_contacto || [], como_conocio: lc.como_conocio || [] }; // [{ valor, color }]
  const puedeListas = ctx.esAdmin() || ctx.edita('ac_alumnos');
  const editor = ctx.edita('ac_seguimiento');
  const verContactos = ctx.ve('ac_seguimiento'); // con «lo suyo» no hay contactos de captación, solo anotaciones de sus alumnos
  if (!verContactos) vista = 'notas';
  const recargar = () => { refrescar(); };
  const cont = h('div');
  const f = { q: '', sit: '', con: '', tipo: '' };
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [...(verContactos ? [['contactos', 'Contactos (captación)']] : []), ['notas', 'Anotaciones de alumnos']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vista === k), onclick: () => { vista = k; seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); f.q = ''; pintar(); } }, l)));
  const buscar = h('input', { type: 'search', placeholder: 'Buscar…', oninput: (e) => { f.q = e.target.value; pintarLista(); } });
  const filtroSel = h('span', { style: 'display:contents' });
  const lista = h('div');

  function pintarLista() {
    const q = normalizar(f.q);
    if (vista === 'contactos') {
      const filas = contactos.filter((c) => (!f.sit || c.situacion === f.sit) && (!f.con || c.como_nos_conocio === f.con) && (!q || normalizar(`${c.nombre} ${c.telefono || ''} ${c.comentarios || ''}`).includes(q))).sort((a, b) => (b.fecha_contacto || '').localeCompare(a.fecha_contacto || ''));
      // desplegable de color dentro de la tabla (si puede editar); cambia el valor al momento sin abrir la ficha
      const celda = (c, campo, items, vacio) => (editor
        ? h('span', { onclick: (e) => e.stopPropagation() }, selColor(items, c[campo] || '', { vacio, label: campo, onchange: async (e) => {
          const v = e.target.value || null; const antes = c[campo];
          try { await api.upd('ac_contactos', c.id, { [campo]: v }); c[campo] = v; toast('Guardado'); } catch (ex) { c[campo] = antes; e.target.value = antes || ''; e.target.dispatchEvent(new Event('change')); toast(ex.message, 'error'); }
        } }))
        : pillColor(c[campo], colorLista(items, c[campo])));
      clear(lista, tabla([
        { t: 'Fecha', v: (c) => fmtFecha(c.fecha_contacto) }, { t: 'Nombre', v: (c) => h('strong', {}, c.nombre) }, { t: 'Teléfono', v: (c) => c.telefono || '' },
        { t: 'Edad', v: (c) => c.edad || '' }, { t: 'Nivel', v: (c) => c.nivel || '' }, { t: 'Comentarios', v: (c) => c.comentarios || '' },
        { t: 'Cómo nos conoció', s: (c) => c.como_nos_conocio || '', v: (c) => celda(c, 'como_nos_conocio', ls.como_conocio, '—') },
        { t: 'Situación', s: (c) => c.situacion || '', v: (c) => celda(c, 'situacion', ls.situacion_contacto) },
      ], filas, { onClick: (c) => abrirContacto(c, { ls, alumnos, ctx, recargar }), vacio: 'No hay contactos.' }));
    } else {
      const filas = anotaciones.filter((n) => (!f.tipo || n.tipo === f.tipo) && (!q || normalizar(`${nombreAlumno(n.alumno)} ${n.texto}`).includes(q))).sort((a, b) => (b.fecha + b.created_at).localeCompare(a.fecha + a.created_at)).slice(0, 300);
      clear(lista, tabla([
        { t: 'Fecha', v: (n) => fmtFecha(n.fecha) }, { t: 'Alumno', v: (n) => h('strong', {}, nombreAlumno(n.alumno)) }, { t: 'Tipo', v: (n) => pill(n.tipo) },
        { t: 'Anotación', v: (n) => n.texto }, { t: 'Profesora', v: (n) => n.profesora?.nombre || '' },
      ], filas, { vacio: 'No hay anotaciones. Se escriben desde la ficha del alumno o con «+ Nueva anotación».' }));
    }
  }
  function pintar() {
    clear(filtroSel, vista === 'contactos' ? [
      selColor(ls.situacion_contacto, f.sit, { vacio: 'Todas las situaciones', onchange: (e) => { f.sit = e.target.value; pintarLista(); } }),
      selColor(ls.como_conocio, f.con, { vacio: 'Cómo nos conoció (todos)', onchange: (e) => { f.con = e.target.value; pintarLista(); } }),
    ] : sel([['', 'Todos los tipos'], ...['nota', 'llamada', 'familia', 'incidencia', 'pago', 'progreso', 'tutoría'].map((s) => [s, s])], f.tipo, { onchange: (e) => { f.tipo = e.target.value; pintarLista(); } }));
    pintarLista();
  }
  const nuevo = editor ? h('button', { class: 'btn primary small', type: 'button', onclick: () => (vista === 'contactos' ? abrirContacto(null, { ls, alumnos, ctx, recargar }) : abrirNota({ alumnos, ctx, recargar })) }, '+ Nuevo') : null;
  const gestionar = verContactos && puedeListas ? h('button', { class: 'btn small', type: 'button', onclick: () => abrirListas({ recargar }) }, '⚙ Listas') : null;
  clear(view, cabecera('Seguimiento', verContactos ? 'Captación de nuevos alumnos y notas del día a día' : 'Notas del día a día de tus alumnos', verContactos ? seg : null, gestionar, nuevo), h('div', { class: 'filters filters-3b' }, buscar, filtroSel), lista);
  pintar();
}

function abrirNota({ alumnos, ctx, recargar }) {
  const d = drawer({ titulo: 'Nueva anotación', ancho: 520 });
  const b = buscadorAlumno(alumnos); const tipo = sel(['nota', 'llamada', 'familia', 'incidencia', 'pago', 'progreso', 'tutoría'], 'nota'); const texto = area('', { rows: 5 });
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Alumno', b, { full: true }), campo('Tipo', tipo), campo('Anotación', texto, { full: true })));
  d.pie.append(h('span'), guardarBoton('Guardar', async () => {
    const a = b.getAlumno(); if (!a) { toast('Elige un alumno de la lista.', 'error'); return; } if (!texto.value.trim()) { toast('Escribe la anotación.', 'error'); return; }
    try { await api.ins('ac_anotaciones', { alumno_id: a.id, tipo: tipo.value, texto: texto.value.trim() }); toast('Anotación guardada'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  }));
}

function abrirContacto(c, { ls, alumnos, ctx, recargar }) {
  const d = drawer({ titulo: c ? c.nombre : 'Nuevo contacto', ancho: 560 });
  const F = { nombre: txt(c?.nombre), tel: txt(c?.telefono), edad: txt(c?.edad), nivel: txt(c?.nivel), conocio: selColor(ls.como_conocio, c?.como_nos_conocio || '', { vacio: '— sin indicar —' }), sit: selColor(ls.situacion_contacto, c?.situacion || ls.situacion_contacto[0]?.valor || ''), fecha: fecha(c?.fecha_contacto || new Date().toISOString().slice(0, 10)), com: area(c?.comentarios, { rows: 4 }) };
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Nombre', F.nombre, { req: true }), campo('Teléfono', F.tel), campo('Edad', F.edad), campo('Nivel', F.nivel), campo('Cómo nos conoció', F.conocio), campo('Situación', F.sit), campo('Fecha de contacto', F.fecha), campo('Comentarios', F.com, { full: true })));
  const guardar = guardarBoton('Guardar', async () => {
    if (!F.nombre.value.trim()) { toast('Falta el nombre.', 'error'); return; }
    const fila = { nombre: F.nombre.value.trim(), telefono: F.tel.value.trim() || null, edad: F.edad.value.trim() || null, nivel: F.nivel.value.trim() || null, como_nos_conocio: F.conocio.value || null, situacion: F.sit.value || 'POSIBLE ALUMNO', fecha_contacto: F.fecha.value || null, comentarios: F.com.value.trim() || null };
    try { if (c) await api.upd('ac_contactos', c.id, fila); else await api.ins('ac_contactos', fila); toast('Guardado'); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); }
  });
  guardar.disabled = !ctx.edita('ac_seguimiento');
  const borrar = c && ctx.esAdmin() ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmar({ titulo: 'Borrar contacto', texto: c.nombre, ok: 'Borrar', peligro: true })) { try { await api.del('ac_contactos', c.id); d.cerrar(); recargar(); } catch (ex) { toast(ex.message, 'error'); } } } }, 'Borrar') : h('span');
  d.pie.append(borrar, guardar);
}

// ---------- editor de las listas «Situación» y «Cómo nos conoció» ----------
const DEFECTO = {
  situacion_contacto: ['POSIBLE ALUMNO', 'EN ESPERA', 'CONTACTADO DE NUEVO', 'NO RESPONDE', 'PRUEBA', 'APUNTADO', 'INSCRITO', 'CONTACTAR PARA PRÓXIMO CURSO', 'NO INTERESADO', 'MOTIVOS ECONÓMICOS', 'NO POR HORARIOS', 'DESCARTADO'],
  como_conocio: ['Colegio', 'AFA / AMPA', 'Familia de un alumno', 'Recomendación', 'Instagram', 'Redes sociales', 'Web', 'Correo', 'Pasaba por la calle', 'Publicidad / folletos', 'Otro'],
};
const LISTAS_ED = [['situacion_contacto', 'Situación', 'situacion'], ['como_conocio', 'Cómo nos conoció', 'como_nos_conocio']];

function abrirListas({ recargar }) {
  let hecho = false; // si algo cambió, al cerrar se recarga la pantalla
  const d = drawer({ titulo: 'Listas de Seguimiento', ancho: 560, onCerrar: () => { if (hecho) recargar(); } });
  const cont = h('div');
  d.cuerpo.append(h('p', { class: 'muted small' }, 'Los valores de estas listas salen en los desplegables de Situación y Cómo nos conoció. Cambia el color, el nombre o el orden; si renombras un valor, se actualiza en todos los contactos que lo usan.'), cont);
  d.pie.append(h('span'), h('button', { class: 'btn primary', type: 'button', onclick: d.cerrar }, 'Listo'));
  const err = (ex) => toast(ex.message, 'error');

  async function pintar() {
    const lc = await api.listasColor();
    clear(cont, LISTAS_ED.map(([lista, titulo, col]) => {
      const items = lc[lista] || [];
      const filas = items.map((it, i) => {
        const usos = h('span', { class: 'usos' }, '…');
        api.contarEnContactos(col, it.valor).then((n) => { usos.textContent = n ? `${n} contacto${n === 1 ? '' : 's'}` : 'sin uso'; usos.dataset.n = n; });
        const color = h('input', { type: 'color', value: it.color || '#6b7280', 'aria-label': `Color de ${it.valor}`, onchange: async (e) => { try { await api.upd('ac_listas', it.id, { color: e.target.value }); hecho = true; } catch (ex) { err(ex); } } });
        const nombre = h('input', { type: 'text', value: it.valor, 'aria-label': `Nombre: ${it.valor}`, onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = it.valor; e.target.blur(); } },
          onblur: async (e) => {
            const nuevo = e.target.value.trim();
            if (!nuevo || nuevo === it.valor) { e.target.value = it.valor; return; }
            if (items.some((x) => x !== it && x.valor.toLowerCase() === nuevo.toLowerCase())) { toast('Ya existe ese valor.', 'error'); e.target.value = it.valor; return; }
            try { await api.upd('ac_listas', it.id, { valor: nuevo }); await api.renombrarEnContactos(col, it.valor, nuevo); hecho = true; toast('Renombrado'); pintar(); } catch (ex) { err(ex); e.target.value = it.valor; }
          } });
        const mover = (dir) => async () => {
          const o = items[i + dir]; if (!o) return;
          try { // se reasignan todos los órdenes para que no haya empates
            const nuevos = items.map((x) => x.id); [nuevos[i], nuevos[i + dir]] = [nuevos[i + dir], nuevos[i]];
            for (let k = 0; k < nuevos.length; k++) if (items.find((x) => x.id === nuevos[k]).orden !== k + 1) await api.upd('ac_listas', nuevos[k], { orden: k + 1 });
            hecho = true; pintar();
          } catch (ex) { err(ex); }
        };
        const borrar = async () => {
          const n = Number(usos.dataset.n || 0);
          const ok = await confirmar({ titulo: 'Quitar de la lista', texto: n ? `«${it.valor}» lo usan ${n} contacto(s). Seguirán mostrándolo (en gris) hasta que lo cambies, pero ya no saldrá en el desplegable.` : `«${it.valor}»`, ok: 'Quitar', peligro: true });
          if (!ok) return;
          try { await api.del('ac_listas', it.id); hecho = true; pintar(); } catch (ex) { err(ex); }
        };
        return h('div', { class: 'lista-ed-fila' }, color, nombre, usos,
          h('span', {}, h('button', { class: 'btn ghost small', type: 'button', disabled: i === 0, 'aria-label': 'Subir', onclick: mover(-1) }, '↑'), h('button', { class: 'btn ghost small', type: 'button', disabled: i === items.length - 1, 'aria-label': 'Bajar', onclick: mover(1) }, '↓')),
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Quitar ${it.valor}`, onclick: borrar }, '🗑'));
      });
      // alta de un valor nuevo
      const nuevoColor = h('input', { type: 'color', value: PALETA_LISTAS[items.length % PALETA_LISTAS.length], 'aria-label': 'Color del nuevo valor' });
      const nuevoNombre = h('input', { type: 'text', placeholder: `Nuevo valor de «${titulo}»` });
      const anadir = async () => {
        const v = nuevoNombre.value.trim(); if (!v) return;
        if (items.some((x) => x.valor.toLowerCase() === v.toLowerCase())) { toast('Ya existe ese valor.', 'error'); return; }
        try { await api.ins('ac_listas', { lista, valor: v, color: nuevoColor.value, orden: items.length + 1 }); hecho = true; pintar(); } catch (ex) { err(ex); }
      };
      nuevoNombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') anadir(); });
      // devuelve los valores de partida que se hayan quitado (nunca borra nada)
      const faltan = DEFECTO[lista].filter((v) => !items.some((x) => x.valor.toLowerCase() === v.toLowerCase()));
      const restaurar = faltan.length ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        try {
          let o = items.length;
          for (const v of faltan) { o++; await api.ins('ac_listas', { lista, valor: v, color: PALETA_LISTAS[o % PALETA_LISTAS.length], orden: o }); }
          hecho = true; toast(`Añadidos ${faltan.length} valores por defecto`); pintar();
        } catch (ex) { err(ex); }
      } }, `Recuperar valores por defecto (${faltan.length})`) : null;
      return h('section', { class: 'form-section' }, h('h3', { style: 'font-size:14px;margin:0 0 8px' }, titulo),
        h('div', { class: 'lista-ed' }, filas, h('div', { class: 'lista-ed-nueva' }, nuevoColor, nuevoNombre, h('button', { class: 'btn small', type: 'button', onclick: anadir }, 'Añadir'))), restaurar);
    }));
  }
  pintar();
}
