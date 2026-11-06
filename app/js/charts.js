// Gráficos SVG hechos a mano (sin librerías): barras agrupadas mensuales y
// barras horizontales clasificadas. Mismo diseño que el prototipo validado.
import { fmtEUR, fmtEUR2 } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

let tooltip;
function tip() {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.setAttribute('aria-hidden', 'true');
    document.body.append(tooltip);
  }
  return tooltip;
}
function showTip(evt, titulo, valor) {
  const t = tip();
  t.replaceChildren(document.createTextNode(titulo), document.createElement('br'));
  const v = document.createElement('span'); v.className = 't-value'; v.textContent = valor;
  t.append(v);
  t.style.left = evt.clientX + 'px';
  t.style.top = evt.clientY + 'px';
  t.classList.add('visible');
}
function hideTip() { if (tooltip) tooltip.classList.remove('visible'); }
window.addEventListener('scroll', hideTip, { passive: true });

function interactivo(target, bar, titulo, valor) {
  const on = (e) => { bar.classList.add('active'); showTip(e, titulo, valor); };
  const off = () => { bar.classList.remove('active'); hideTip(); };
  target.addEventListener('pointerenter', on);
  target.addEventListener('pointermove', on);
  target.addEventListener('pointerdown', on);
  target.addEventListener('pointerleave', off);
  target.addEventListener('pointercancel', off);
}

function niceStep(max) {
  if (max <= 0) return 1000;
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * pow;
}
const kLabel = (v) => (v >= 1000 ? (v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + 'k' : String(v));
// en pantallas estrechas se dibuja con menos ancho para que el texto no encoja
export const esEstrecho = () => window.matchMedia('(max-width: 560px)').matches;

/**
 * series: [{ nombre, clase, valores: number[] }]  (misma longitud que etiquetas)
 */
export function barrasAgrupadas(etiquetas, series, { etiquetasLargas = etiquetas, ariaLabel, ancho = 640 } = {}) {
  const W = ancho, H = ancho < 500 ? 240 : 290, padL = 46, padR = 8, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(0, ...series.flatMap((x) => x.valores));
  const step = niceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const y = (v) => padT + plotH - (v / top) * plotH;

  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel || 'Gráfico de barras' });
  for (let v = 0; v <= top + 1e-6; v += step) {
    svg.append(s('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? 'axis-line' : 'grid-line' }));
    svg.append(s('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': '10.5' }, kLabel(v)));
  }
  const groupW = plotW / etiquetas.length;
  const gap = 2;
  const barW = Math.min(18, (groupW * 0.72 - gap * (series.length - 1)) / series.length);
  const groupInner = barW * series.length + gap * (series.length - 1);

  etiquetas.forEach((et, i) => {
    const gx = padL + i * groupW;
    const x0 = gx + (groupW - groupInner) / 2;
    series.forEach((serie, j) => {
      const v = serie.valores[i] || 0;
      const hgt = Math.max(v > 0 ? 1.5 : 0, padT + plotH - y(v));
      const x = x0 + j * (barW + gap);
      const titulo = `${etiquetasLargas[i]} · ${serie.nombre}`;
      const hit = s('rect', { x: x - gap / 2, y: padT, width: barW + gap, height: plotH, class: 'hit' });
      const bar = s('rect', { x, y: padT + plotH - hgt, width: barW, height: hgt, rx: Math.min(3, barW / 3), class: 'bar ' + serie.clase });
      bar.append(s('title', {}, `${titulo}: ${fmtEUR2(v)}`));
      interactivo(hit, bar, titulo, fmtEUR2(v));
      svg.append(hit, bar);
    });
    svg.append(s('text', { x: gx + groupW / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': '10.5' }, et));
  });
  return svg;
}

/** datos: [{ nombre, valor }] ya ordenados de mayor a menor */
export function barrasClasificadas(datos, { ariaLabel, ancho = 420 } = {}) {
  const W = ancho, rowH = 24, gap = 7, padL = 104, padR = 70, padT = 4;
  const H = padT + datos.length * (rowH + gap);
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const plotW = W - padL - padR;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel || 'Gráfico de barras' });
  datos.forEach((d, i) => {
    const yTop = padT + i * (rowH + gap);
    const w = Math.max(2, (d.valor / max) * plotW);
    svg.append(s('text', { x: padL - 10, y: yTop + rowH / 2 + 4, 'text-anchor': 'end', 'font-size': '11.5' }, d.nombre));
    const hit = s('rect', { x: 0, y: yTop - gap / 2, width: W, height: rowH + gap, class: 'hit' });
    const bar = s('rect', { x: padL, y: yTop, width: w, height: rowH, rx: 4, class: 'bar bar-rank' });
    bar.append(s('title', {}, `${d.nombre}: ${fmtEUR2(d.valor)}`));
    interactivo(hit, bar, d.nombre, fmtEUR2(d.valor));
    svg.append(hit, bar);
    svg.append(s('text', { x: padL + w + 8, y: yTop + rowH / 2 + 4, 'font-size': '11', class: 'val-label' }, fmtEUR(d.valor)));
  });
  return svg;
}
