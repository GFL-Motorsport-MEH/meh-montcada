// Lector de extractos en formato Norma 43 (AEB/CSB 43), sin DOM.
// Devuelve una lista de cuentas (un archivo puede traer varias), cada una con su periodo, saldos y movimientos.
const fecha = (s) => (/^\d{6}$/.test(s) ? `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}` : null);
const importe = (s) => Number(s) / 100;

export function esN43(texto) {
  const l = String(texto || '').split(/\r?\n/).find((x) => x.trim());
  return !!l && /^11\d{18}\d{12}[12]\d{14}/.test(l);
}

export function parsearN43(texto) {
  const cuentas = [];
  let c = null, mov = null;
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const t = linea.replace(/\s+$/, '');
    const reg = t.slice(0, 2);
    if (reg === '11') {
      c = { entidad: t.slice(2, 6), oficina: t.slice(6, 10), cuenta: t.slice(10, 20), desde: fecha(t.slice(20, 26)), hasta: fecha(t.slice(26, 32)),
        saldo_inicial: importe(t.slice(33, 47)) * (t[32] === '1' ? -1 : 1), divisa: t.slice(47, 50), titular: t.slice(51, 77).trim(), saldo_final: null, movimientos: [] };
      cuentas.push(c);
    } else if (reg === '22' && c) {
      const signo = t[27] === '1' ? -1 : 1;
      mov = { fecha: fecha(t.slice(10, 16)), fecha_valor: fecha(t.slice(16, 22)), concepto_comun: t.slice(22, 24), importe: signo * importe(t.slice(28, 42)),
        documento: t.slice(42, 52).trim(), referencia: `${t.slice(52, 64).trim()} ${t.slice(64, 80).trim()}`.trim(), concepto: '' };
      c.movimientos.push(mov);
    } else if (reg === '23' && mov) {
      mov.concepto = `${mov.concepto} ${t.slice(4, 42).trim()} ${t.slice(42, 80).trim()}`.replace(/\s+/g, ' ').trim();
    } else if (reg === '33' && c) {
      c.saldo_final = importe(t.slice(59, 73)) * (t[58] === '1' ? -1 : 1);
      c.total_debe = importe(t.slice(25, 39)); c.total_haber = importe(t.slice(44, 58));
      mov = null;
    }
  }
  for (const x of cuentas) for (const m of x.movimientos) if (!m.concepto) m.concepto = m.referencia || m.documento || '';
  return cuentas;
}

// Busca la cuenta de la app que corresponde (por los dígitos del IBAN: entidad + oficina + nº de cuenta)
export function cuentaN43(c, cuentas) {
  const dig = `${c.entidad}${c.oficina}`;
  return cuentas.find((x) => { const i = String(x.iban || '').replace(/\s/g, ''); return i && i.includes(dig) && i.endsWith(c.cuenta); })
    || cuentas.find((x) => String(x.iban || '').replace(/\s/g, '').endsWith(c.cuenta)) || null;
}
