// Configuración > Listas: categorías y subcategorías, métodos de pago, periodicidad y tipo de documento.
// Cambiar un nombre lo cambia en todos los gastos de todos los cursos (las categorías van por id; las listas por la BD).
import { h, clear, cargando, toast, confirmar, tituloCategoria } from '../ui.js';
import * as db from '../db.js';
import { registrarSeccionConfig } from './config.js';

const LISTAS = [['metodo_pago', 'Métodos de pago'], ['periodicidad', 'Periodicidad'], ['tipo', 'Tipo de documento']];
// Nombres que usa el cálculo del Balance: no se pueden renombrar desde aquí.
const PROTEGIDAS = { cat: ['INVERSION', 'WELCOME PACK'], sub: ['Impuesto Sociedades'] };

function editable({ valor, label, puede, bloqueado, onGuardar }) {
  if (!puede || bloqueado) {
    return h('span', { class: 'valor-lista' }, valor, bloqueado ? h('span', { class: 'pill off', title: 'La usa el cálculo del Balance' }, 'balance') : null);
  }
  const input = h('input', { type: 'text', class: 'cell cell-text', value: valor, 'aria-label': `${label}: ${valor}` });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = valor; input.blur(); } });
  input.addEventListener('blur', async () => {
    const nuevo = input.value.trim();
    if (!nuevo || nuevo === valor) { input.value = valor; return; }
    input.classList.add('saving');
    const ok = await onGuardar(nuevo).catch((ex) => { toast('No se ha guardado: ' + ex.message, 'error'); return false; });
    input.classList.remove('saving');
    if (ok === false) input.value = valor; else { valor = nuevo; input.classList.add('saved'); setTimeout(() => input.classList.remove('saved'), 900); }
  });
  return input;
}

function anadir(placeholder, onAnadir) {
  const input = h('input', { type: 'text', placeholder, 'aria-label': placeholder, class: 'input-anadir' });
  const enviar = async () => { const v = input.value.trim(); if (!v) return; if (await onAnadir(v).catch((ex) => { toast('No se ha añadido: ' + ex.message, 'error'); return false; }) !== false) input.value = ''; };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
  return h('div', { class: 'fila-anadir' }, input, h('button', { class: 'btn small', onclick: enviar }, 'Añadir'));
}

async function renderListas(cont, ctx) {
  clear(cont, cargando());
  const admin = ctx.esAdmin();
  const listas = await db.getListas();
  ctx.state.listas = listas;
  const tax = ctx.state.taxonomia;
  const usos = { cat: new Map(), sub: new Map(), metodo_pago: new Map(), periodicidad: new Map(), tipo: new Map() };
  for (const c of ctx.state.cursosVisibles) {
    for (const g of await ctx.gastos(c.id)) {
      usos.cat.set(g.categoria_id, (usos.cat.get(g.categoria_id) || 0) + 1);
      usos.sub.set(g.subcategoria_id, (usos.sub.get(g.subcategoria_id) || 0) + 1);
      for (const l of ['metodo_pago', 'periodicidad', 'tipo']) if (g[l]) usos[l].set(g[l], (usos[l].get(g[l]) || 0) + 1);
    }
  }
  const nUsos = (n) => h('span', { class: 'muted small usos' }, n ? `${n} gastos` : 'sin uso');
  const invalidarGastos = () => { for (const c of ctx.state.cursos) ctx.invalidar(c.id); ctx.state.sugerencias = null; };

  // ---- categorías ----
  const arbol = h('div', { class: 'arbol-cats' });
  function pintarArbol() {
    clear(arbol, tax.map((c) => h('details', { class: 'cat-item' },
      h('summary', {},
        editable({ valor: tituloCategoria(c.nombre), label: 'Categoría', puede: admin, bloqueado: PROTEGIDAS.cat.includes(c.nombre),
          onGuardar: async (v) => {
            const nombre = v.toUpperCase();
            if (tax.some((x) => x !== c && x.nombre === nombre)) { toast(`Ya existe la categoría ${v}.`, 'error'); return false; }
            Object.assign(c, await db.actualizarCategoria(c.id, { nombre }));
            toast(`Categoría renombrada: se ve así en sus ${usos.cat.get(c.id) || 0} gastos de todos los cursos.`);
          } }),
        nUsos(usos.cat.get(c.id)), h('span', { class: 'muted small' }, ` · ${c.subcategorias.length} subcategorías`)),
      h('ul', { class: 'subs' }, c.subcategorias.map((s) => h('li', {},
        editable({ valor: s.nombre, label: `Subcategoría de ${tituloCategoria(c.nombre)}`, puede: admin, bloqueado: PROTEGIDAS.sub.includes(s.nombre),
          onGuardar: async (v) => {
            if (c.subcategorias.some((x) => x !== s && x.nombre.toLowerCase() === v.toLowerCase())) { toast(`Ya existe la subcategoría ${v}.`, 'error'); return false; }
            Object.assign(s, await db.actualizarSubcategoria(s.id, { nombre: v }));
            toast(`Subcategoría renombrada en sus ${usos.sub.get(s.id) || 0} gastos.`);
          } }),
        nUsos(usos.sub.get(s.id))))),
      admin ? anadir(`Nueva subcategoría de ${tituloCategoria(c.nombre)}`, async (v) => {
        if (c.subcategorias.some((x) => x.nombre.toLowerCase() === v.toLowerCase())) { toast('Ya existe.', 'error'); return false; }
        c.subcategorias.push(await db.crearSubcategoria(c.id, v, c.subcategorias.length));
        pintarArbol(); arbol.querySelectorAll('details')[tax.indexOf(c)].open = true;
      }) : null)));
  }
  pintarArbol();

  // ---- listas simples ----
  const tarjetaLista = ([lista, titulo]) => {
    const ul = h('ul', { class: 'lista-valores' });
    const pintar = () => clear(ul, listas.filter((x) => x.lista === lista).map((x) => h('li', {},
      editable({ valor: x.valor, label: titulo, puede: admin, onGuardar: async (v) => {
        const destino = listas.find((y) => y !== x && y.lista === lista && y.valor.toLowerCase() === v.toLowerCase());
        const n = usos[lista].get(x.valor) || 0;
        const ok = await confirmar({ titulo: destino ? 'Fusionar valores' : 'Cambiar valor',
          texto: destino ? `"${x.valor}" se unirá a "${destino.valor}" y sus ${n} gastos pasarán a "${destino.valor}".` : `Se cambiará "${x.valor}" por "${v}" en ${n} gastos de todos los cursos.`,
          ok: destino ? 'Fusionar' : 'Cambiar en todo' });
        if (!ok) return false;
        const cambiados = await db.renombrarValorLista(lista, x.valor, destino ? destino.valor : v);
        usos[lista].set(destino ? destino.valor : v, (usos[lista].get(destino?.valor) || 0) + n); usos[lista].delete(x.valor);
        if (destino) listas.splice(listas.indexOf(x), 1); else x.valor = v;
        invalidarGastos(); pintar();
        toast(`Cambiado en ${cambiados} gastos.`);
      } }),
      nUsos(usos[lista].get(x.valor)))));
    pintar();
    return h('section', { class: 'card lista-card' }, h('h3', {}, titulo), ul,
      admin ? anadir(`Nuevo valor de ${titulo.toLowerCase()}`, async (v) => {
        if (listas.some((x) => x.lista === lista && x.valor.toLowerCase() === v.toLowerCase())) { toast('Ya existe.', 'error'); return false; }
        listas.push(await db.crearValorLista(lista, v, listas.filter((x) => x.lista === lista).length + 1)); pintar();
      }) : null);
  };

  clear(cont,
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'Listas'), h('div', { class: 'count' },
      admin ? 'Al cambiar un nombre se cambia en todos los gastos de todos los cursos. Si escribes un valor que ya existe, se fusionan.' : 'Solo un administrador puede cambiar las listas.'))),
    h('div', { class: 'listas-grid' },
      h('section', { class: 'card lista-card cats' }, h('h3', {}, 'Categorías y subcategorías'), arbol,
        admin ? anadir('Nueva categoría', async (v) => {
          const nombre = v.toUpperCase();
          if (tax.some((x) => x.nombre === nombre)) { toast('Ya existe.', 'error'); return false; }
          tax.push({ ...(await db.crearCategoria(nombre, tax.length)), subcategorias: [] }); pintarArbol();
        }) : null),
      h('div', { class: 'listas-col' }, LISTAS.map(tarjetaLista))));
}

registrarSeccionConfig('listas', renderListas);
