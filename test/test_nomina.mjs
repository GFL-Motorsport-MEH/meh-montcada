// node test/test_nomina.mjs — lectura de nóminas (líquido, SS trabajador + empresa, IRPF)
import { analizarNomina, esNomina } from '../app/js/escaner-nomina.js';
import assert from 'node:assert/strict';

// Formato 1: recibo oficial de salarios
const t1 = `RECIBO INDIVIDUAL DE SALARIOS
Empresa: MIMAG ENGLISH SL  CIF: B22652960
Trabajador: ALCALA PEREZ, PAULA   DNI 12345678Z
Periodo de liquidación: del 01/10/2026 al 31/10/2026
I. DEVENGOS
Salario base 1.900,00
TOTAL DEVENGADO 1.900,00
II. DEDUCCIONES
1. Aportación del trabajador a las cotizaciones de la Seguridad Social
Contingencias comunes 4,70 % 89,30
Desempleo 1,55 % 29,45
Formación profesional 0,10 % 1,90
MEI 0,13 % 2,47
TOTAL APORTACIONES 123,12
2. Impuesto sobre la Renta de las Personas Físicas (IRPF)
Base sujeta a retención 1.900,00 Tipo 11,83 % 224,84
TOTAL A DEDUCIR 347,96
LÍQUIDO A PERCIBIR 1.552,04
Aportación de la empresa
Contingencias comunes 23,60 % 448,40
Total aportación empresa 589,62
`;
{
  assert.ok(esNomina(t1));
  const r = analizarNomina(t1, { propios: ['B22652960'] });
  assert.equal(r.liquido, 1552.04); assert.equal(r.irpf, 224.84);
  assert.equal(r.ssTrabajador, 123.12); assert.equal(r.ssEmpresa, 589.62); assert.equal(r.ss, 712.74);
  assert.equal(r.fecha, '2026-10-31'); assert.equal(r.nif, '12345678Z');
  assert.match(r.trabajador, /ALCALA PEREZ, PAULA/);
}

// Formato 2: sin IRPF y con la cuota del trabajador por conceptos (sin total); periodo por mes y año
const t2 = `NÓMINA OCTUBRE 2026
Nombre y apellidos: Nuria Ruiperez Davila
DEDUCCIONES
Contingencias comunes 4,70% 52,10
Desempleo 1,55% 17,18
Formación profesional 0,10% 1,11
Retención IRPF 0,00% 0,00
LIQUIDO A PERCIBIR 1.020,61
Cotización empresa 305,20
`;
{
  assert.ok(esNomina(t2));
  const r = analizarNomina(t2);
  assert.equal(r.liquido, 1020.61); assert.equal(r.irpf, 0);
  assert.equal(r.ssTrabajador, 70.39); assert.equal(r.ssEmpresa, 305.2); assert.equal(r.ss, 375.59);
  assert.equal(r.fecha, '2026-10-31'); assert.equal(r.trabajador, 'Nuria Ruiperez Davila');
}

// Una factura normal no es una nómina
assert.ok(!esNomina('FACTURA 123\nTotal 44,20 €\nVodafone'));
console.log('OK nóminas');
