// Seguimiento: contactos que aún no son alumnos (captación) y feed de anotaciones de todos los alumnos.
import { vista as vistaEstado, leerV, guardarV, vincular, escuchar, crearAviso, busqueda } from '../vista.js';
import { h, clear, cargando, toast, confirmar, fmtFecha, normalizar } from '../ui.js';
import * as api from './api.js';
import { campo, txt, area, fecha, sel, drawer, cabecera, tabla, pill, pillColor, selColor, colorLista, edad, edadNumerica, nivelPorEdad, PALETA_LISTAS, nombreAlumno, guardarBoton, buscadorAlumno, refrescar } from './kit.js';

let vista = 'contactos'; // se recuerda al refrescar (se lee al pintar)

export async function renderSeguimiento(view, ctx) {
  clear(view, cargando());
  const [contactos, anotaciones, alumnos, lc] = await Promise.all([api.contactos(), api.anotaciones(), api.alumnos(), api.listasColor()]);
  const ls = { situacion_contacto: lc.situacion_contacto || [], como_conocio: lc.como_conocio || [], nivel_contacto: lc.nivel_contacto || [] }; // [{ valor, color, … }]
  const alPorId = new Map(alumnos.map((a) => [a.id, a]));
  const puedeListas = ctx.esAdmin() || ctx.edita('ac_alumnos');
  const editor = ctx.edita('ac_seguimiento');
  const verContactos = ctx.ve('ac_seguimiento'); // con «lo suyo» no hay contactos de captación, solo anotaciones de sus alumnos
  vista = leerV('seguimiento.vista', 'contactos');
  if (!verContactos) vista = 'notas';
  const recargar = () => { refrescar(); };
  const cont = h('div');
  const f = vistaEstado('seguimiento.f', { q: '', sit: '', con: '', tipo: '' });
  if (!['contactos', 'notas'].includes(vista)) vista = 'contactos';
  const seg = h('div', { class: 'segmented', role: 'tablist' }, [...(verContactos ? [['contactos', 'Contactos (captación)']] : []), ['notas', 'Anotaciones de alumnos']].map(([k, l]) =>
    h('button', { class: 'seg-btn', role: 'tab', type: 'button', 'aria-selected': String(vista === k), onclick: () => { vista = k; guardarV('seguimiento.vista', k); seg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === l))); f.q = ''; pintar(); } }, l)));
  const buscar = vincular(f, 'q', h('input', { type: 'search', placeholder: 'Buscar…', oninput: (e) => { f.q = e.target.value; pintarLista(); } }));
  const aviso = crearAviso({
    obtener: () => (vista === 'contactos' ? [['Búsqueda', busqueda(f.q)], ['Situación', f.sit], ['Cómo nos conoció', f.con]] : [['Búsqueda', busqueda(f.q)], ['Tipo', f.tipo]]),
    limpiar: () => { f.q = ''; f.sit = ''; f.con = ''; f.tipo = ''; pintar(); },
  });
  escuchar(f, () => aviso.actualizar());
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
          const volver = () => { e.target.value = antes || ''; e.target.dispatchEvent(new Event('repintar')); };
          // un valor que pide alumno sin alumno enlazado: se abre la ficha para elegirlo
          if (campo === 'como_nos_conocio' && v && items.find((x) => x.valor === v)?.pide_alumno && !c.alumno_referente_id) {
            volver(); toast('Este valor pide un alumno relacionado: elígelo en la ficha.'); abrirContacto(c, { ls, alumnos, ctx, recargar, preset: { como_nos_conocio: v } }); return;
          }
          try { await api.upd('ac_contactos', c.id, { [campo]: v }); c[campo] = v; toast('Guardado'); } catch (ex) { c[campo] = antes; volver(); toast(ex.message, 'error'); }
        } }))
        : pillColor(c[campo], colorLista(items, c[campo])));
      // casilla Sí/No dentro de la tabla
      const marca = (c, campo, etiqueta) => (editor
        ? h('span', { onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', checked: !!c[campo], 'aria-label': `${etiqueta}: ${c.nombre}`, onchange: async (e) => {
          try { await api.upd('ac_contactos', c.id, { [campo]: e.target.checked }); c[campo] = e.target.checked; } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message, 'error'); }
        } }))
        : (c[campo] ? pillColor('Sí', '#16a34a') : h('span', { class: 'muted' }, 'No')));
      clear(lista, tabla([
        { t: 'Fecha', v: (c) => fmtFecha(c.fecha_contacto) }, { t: 'Nombre', v: (c) => h('strong', {}, c.nombre) }, { t: 'Teléfono', v: (c) => c.telefono || '' },
        { t: 'Edad', v: (c) => c.edad || (c.fecha_nacimiento ? `${edad(c.fecha_nacimiento)} años` : '') },
        { t: 'Nivel', s: (c) => c.nivel || '', v: (c) => celda(c, 'nivel', ls.nivel_contacto, '—') },
        { t: 'Intensivos', s: (c) => (c.cursos_intensivos ? 'Sí' : 'No'), v: (c) => marca(c, 'cursos_intensivos', 'Cursos intensivos') },
        { t: 'Mañanas', s: (c) => (c.mananas ? 'Sí' : 'No'), v: (c) => marca(c, 'mananas', 'Mañanas') },
        { t: 'Comentarios', v: (c) => c.comentarios || '' },
        { t: 'Cómo nos conoció', s: (c) => c.como_nos_conocio || '', v: (c) => celda(c, 'como_nos_conocio', ls.como_conocio, '—') },
        { t: 'Alumno relacionado', s: (c) => (alPorId.get(c.alumno_referente_id) ? nombreAlumno(alPorId.get(c.alumno_referente_id)) : ''), v: (c) => (alPorId.get(c.alumno_referente_id) ? nombreAlumno(alPorId.get(c.alumno_referente_id)) : '') },
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
  clear(view, cabecera('Seguimiento', verContactos ? 'Captación de nuevos alumnos y notas del día a día' : 'Notas del día a día de tus alumnos', verContactos ? seg : null, gestionar, nuevo), h('div', { class: 'filters filters-3b' }, buscar, filtroSel), aviso, lista);
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

function abrirContacto(c, { ls, alumnos, ctx, recargar, preset = {} }) {
  const d = drawer({ titulo: c ? c.nombre : 'Nuevo contacto', ancho: 560 });
  const check = (v) => h('input', { type: 'checkbox', checked: !!v });
  const F = { nombre: txt(c?.nombre), tel: txt(c?.telefono), fnac: fecha(c?.fecha_nacimiento), edad: txt(c?.edad, { placeholder: 'años' }),
    nivel: selColor(ls.nivel_contacto, c?.nivel || '', { vacio: '— sin indicar —' }), intens: check(c?.cursos_intensivos), man: check(c?.mananas),
    conocio: selColor(ls.como_conocio, preset.como_nos_conocio ?? c?.como_nos_conocio ?? '', { vacio: '— sin indicar —' }), sit: selColor(ls.situacion_contacto, c?.situacion || ls.situacion_contacto[0]?.valor || ''),
    fecha: fecha(c?.fecha_contacto || new Date().toISOString().slice(0, 10)), com: area(c?.comentarios, { rows: 4 }) };
  // Nivel: se propone solo según la fecha de nacimiento o la edad, hasta que se elige a mano
  let manual = !!c?.nivel; let poniendo = false;
  F.nivel.addEventListener('change', () => { if (!poniendo) manual = true; });
  const proponer = () => {
    const e = edadNumerica(F.edad.value, F.fnac.value);
    if (manual) return;
    const it = nivelPorEdad(ls.nivel_contacto, e);
    poniendo = true; F.nivel.value = it ? it.valor : ''; F.nivel.dispatchEvent(new Event('change')); poniendo = false;
  };
  F.fnac.addEventListener('change', () => { if (F.fnac.value) F.edad.value = `${edad(F.fnac.value)} años`; proponer(); });
  F.edad.addEventListener('input', proponer);
  // alumno relacionado: obligatorio si «Cómo nos conoció» es uno de los que lo piden (familia de un alumno, recomendación…)
  const buscador = buscadorAlumno(alumnos, { valorId: c?.alumno_referente_id, placeholder: 'Escribe el apellido o nombre del alumno…' });
  const campoAlumno = campo('Alumno relacionado', buscador, { full: true, req: true });
  const pide = () => !!ls.como_conocio.find((x) => x.valor === F.conocio.value)?.pide_alumno;
  const mostrar = () => { campoAlumno.style.display = pide() ? '' : 'none'; };
  F.conocio.addEventListener('change', mostrar); mostrar();
  d.cuerpo.append(h('div', { class: 'form-section' }, campo('Nombre', F.nombre, { req: true }), campo('Teléfono', F.tel), campo('Fecha de nacimiento', F.fnac), campo('Edad', F.edad),
    campo('Nivel (se propone según la edad)', F.nivel), h('div', { class: 'field ac-checks' }, h('label', {}, F.intens, ' Cursos intensivos'), h('label', {}, F.man, ' Mañanas')),
    campo('Cómo nos conoció', F.conocio), campoAlumno, campo('Situación', F.sit), campo('Fecha de contacto', F.fecha), campo('Comentarios', F.com, { full: true })));
  const guardar = guardarBoton('Guardar', async () => {
    if (!F.nombre.value.trim()) { toast('Falta el nombre.', 'error'); return; }
    let ref = null;
    if (pide()) {
      const a = buscador.getAlumno();
      if (buscador.input.value.trim() && !a) { toast('Elige un alumno de la lista (inscrito o no).', 'error'); return; }
      if (a) ref = a.id;
      else if (c && c.como_nos_conocio === F.conocio.value) ref = c.alumno_referente_id || null; // contacto antiguo sin cambiar: no se obliga
      else { toast(`«${F.conocio.value}» pide enlazar un alumno: elígelo en «Alumno relacionado».`, 'error'); return; }
    }
    const fila = { nombre: F.nombre.value.trim(), telefono: F.tel.value.trim() || null, fecha_nacimiento: F.fnac.value || null, edad: F.edad.value.trim() || null, nivel: F.nivel.value || null,
      cursos_intensivos: F.intens.checked, mananas: F.man.checked, como_nos_conocio: F.conocio.value || null, alumno_referente_id: ref, situacion: F.sit.value || 'POSIBLE ALUMNO', fecha_contacto: F.fecha.value || null, comentarios: F.com.value.trim() || null };
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
  nivel_contacto: ['BABIES', 'KIDS', 'TEENS', 'ADULTS', 'ADULTS A2', 'ADULTS B1', 'ADULTS B2', 'ADULTS C1', 'LEVEL 1', 'LEVEL 2', 'LEVEL 3', 'LEVEL 4', 'LEVEL 5', 'SPEAKING'],
};
// datos extra de los valores de partida (tramo de edad del nivel; si el valor pide un alumno relacionado)
const DEFECTO_EXTRA = {
  'nivel_contacto:BABIES': { edad_min: 0, edad_max: 3 }, 'nivel_contacto:KIDS': { edad_min: 4, edad_max: 11 }, 'nivel_contacto:TEENS': { edad_min: 12, edad_max: 17 }, 'nivel_contacto:ADULTS': { edad_min: 18, edad_max: 120 },
  'como_conocio:Familia de un alumno': { pide_alumno: true }, 'como_conocio:Recomendación': { pide_alumno: true },
};
const LISTAS_ED = [['situacion_contacto', 'Situación', 'situacion'], ['como_conocio', 'Cómo nos conoció', 'como_nos_conocio'], ['nivel_contacto', 'Nivel (se propone según la edad)', 'nivel']];

function abrirListas({ recargar }) {
  let hecho = false; // si algo cambió, al cerrar se recarga la pantalla
  const d = drawer({ titulo: 'Listas de Seguimiento', ancho: 560, onCerrar: () => { if (hecho) recargar(); } });
  const cont = h('div');
  d.cuerpo.append(h('p', { class: 'muted small' }, 'Los valores de estas listas salen en los desplegables de Situación, Cómo nos conoció y Nivel. Cambia el color, el nombre o el orden; si renombras un valor, se actualiza en todos los contactos que lo usan.'), cont);
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
        let extra = h('span');
        if (lista === 'nivel_contacto') {
          const num = (campo2, ph) => h('input', { type: 'number', min: 0, max: 120, value: it[campo2] ?? '', placeholder: ph, 'aria-label': `${ph} de ${it.valor}`, class: 'ed-edad',
            onchange: async (e) => { const v = e.target.value === '' ? null : Number(e.target.value); try { await api.upd('ac_listas', it.id, { [campo2]: v }); it[campo2] = v; hecho = true; } catch (ex) { err(ex); } } });
          extra = h('span', { class: 'ed-extra', title: 'Edad en la que se propone este nivel solo (déjalo vacío para no proponerlo)' }, num('edad_min', 'desde'), '–', num('edad_max', 'hasta'), ' años');
        } else if (lista === 'como_conocio') {
          extra = h('label', { class: 'ed-extra', title: 'Obliga a enlazar un alumno al añadir un contacto con este valor' }, h('input', { type: 'checkbox', checked: it.pide_alumno,
            onchange: async (e) => { try { await api.upd('ac_listas', it.id, { pide_alumno: e.target.checked }); hecho = true; } catch (ex) { err(ex); e.target.checked = !e.target.checked; } } }), ' pide alumno');
        }
        return h('div', { class: 'lista-ed-fila' }, color, nombre, extra, usos,
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
          for (const v of faltan) { o++; await api.ins('ac_listas', { lista, valor: v, color: PALETA_LISTAS[o % PALETA_LISTAS.length], orden: o, ...(DEFECTO_EXTRA[`${lista}:${v}`] || {}) }); }
          hecho = true; toast(`Añadidos ${faltan.length} valores por defecto`); pintar();
        } catch (ex) { err(ex); }
      } }, `Recuperar valores por defecto (${faltan.length})`) : null;
      return h('section', { class: 'form-section' }, h('h3', { style: 'font-size:14px;margin:0 0 8px' }, titulo),
        h('div', { class: 'lista-ed' }, filas, h('div', { class: 'lista-ed-nueva' }, nuevoColor, nuevoNombre, h('button', { class: 'btn small', type: 'button', onclick: anadir }, 'Añadir'))), restaurar);
    }));
  }
  pintar();
}
