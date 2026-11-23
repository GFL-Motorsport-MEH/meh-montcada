// Un mismo PDF puede traer varios documentos (las nóminas de toda la plantilla, varias facturas seguidas…).
// segmentar() recibe el texto de cada página y devuelve los documentos: [{ paginas: [0, 1], tipo: 'nomina'|'factura', texto }].
// Una nómina empieza en cada página que lo parece; una factura, en cada página con un nº de factura distinto del anterior.
// Las páginas que no empiezan nada (continuación, anexos) se pegan al documento anterior.
import { esNomina } from './escaner-nomina.js';

export function segmentar(textos, { analizarFactura, propios = [] }) {
  const docs = [];
  textos.forEach((t, i) => {
    const vacia = t.replace(/\s/g, '').length < 20;
    if (vacia && docs.length) { docs[docs.length - 1].paginas.push(i); docs[docs.length - 1].texto += '\n' + t; return; }
    const nomina = esNomina(t);
    const num = nomina ? null : analizarFactura(t, { propios }).numero;
    const previo = docs[docs.length - 1];
    const empieza = !previo || nomina || previo.tipo === 'nomina' && !nomina && !!num
      || (!nomina && previo.tipo === 'factura' && !!num && num !== previo.numero)
      || (!nomina && previo.tipo === 'factura' && !previo.numero && !!num);
    if (empieza) docs.push({ paginas: [i], tipo: nomina ? 'nomina' : 'factura', numero: num, texto: t });
    else { previo.paginas.push(i); previo.texto += '\n' + t; if (!previo.numero && num) previo.numero = num; }
  });
  return docs;
}
