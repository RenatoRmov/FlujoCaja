
// Lógica pura de los importadores de Excel (sin React ni acceso a la base).
// Se mantiene aparte para poder probarla con Node contra el Excel real.
import type { WorkSheet } from 'xlsx';
import type { CuentaPendiente, CategoryType, PaymentMethod, AccountStatus } from './types';

// ── Fechas (YYYY-MM-DD, sin zonas horarias) ───────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

export const addMonthsIso = (iso: string, k: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  const ny = Math.floor(t / 12);
  const nm = t % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, dim))}`;
};

export const monthsBetween = (a: string, b: string): number => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
};

const monthOf = (iso: string) => iso.substring(0, 7);

const monthRange = (monthStr: string) => {
  const start = `${monthOf(monthStr)}-01`;
  const end = addMonthsIso(start, 1);
  return { start, endExclusive: end };
};

/** ¿La cuenta pertenece al mes? (por columna `mes` o por fecha de vencimiento dentro del mes) */
export const belongsToMonth = (item: CuentaPendiente, monthStr: string): boolean => {
  const { start, endExclusive } = monthRange(monthStr);
  if (item.mes === monthStr) return true;
  return !!item.vencimiento && item.vencimiento >= start && item.vencimiento < endExclusive;
};

// ── Identificación de créditos ────────────────────────────────────────────────

export const LOAN_PREFIX = 'loan#';
const LOAN_WORDS = /cr[eé]dito|pr[eé]stamo|bancoestado|banco estado/i;
const CUOTA_SUFFIX = /\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/;

/** Código de 4 dígitos que identifica un crédito: "(2279)" o " 0066 ". Solo para descripciones de créditos. */
export function loanCode(desc: string): string | null {
  if (!LOAN_WORDS.test(desc)) return null;
  const clean = desc.replace(/\(\s*\d+\s*\/\s*\d+\s*\)/g, ' ');
  const m = clean.match(/(?:^|[\s(])(\d{4})(?=[\s)\-]|$)/);
  return m ? m[1] : null;
}

/** Clave de comparación entre descripciones. Los créditos con código se distinguen por ese código. */
export function normalizeDesc(desc: string): string {
  const code = loanCode(desc);
  if (code) return `${LOAN_PREFIX}${code}`;
  return desc
    .toLowerCase()
    .replace(/\s*\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Palabras de una descripción (sin acentos ni paréntesis), para comparar sin importar el orden. */
export function tokenSet(desc: string): Set<string> {
  const t = stripAccents(desc.toLowerCase())
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return new Set(t);
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));
const isSubset = (a: Set<string>, b: Set<string>) => [...a].every(x => b.has(x));

export const baseName = (desc: string): string => desc.replace(CUOTA_SUFFIX, '').trim();

const parseCuota = (desc: string): { n: number; total: number } | null => {
  const m = desc.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*$/);
  return m ? { n: Number(m[1]), total: Number(m[2]) } : null;
};

const claimKey = (c: CuentaPendiente): string => c.groupId ?? (loanCode(c.descripcion) ? `${LOAN_PREFIX}${loanCode(c.descripcion)}` : c.id);

interface Candidate { item: CuentaPendiente; score: number }

/** Cuentas del sistema que probablemente corresponden a la descripción del Excel (mejores primero por puntaje). */
export function findCxpMatches(desc: string, existing: CuentaPendiente[]): Candidate[] {
  const n = normalizeDesc(desc);
  const out: Candidate[] = [];

  if (n.startsWith(LOAN_PREFIX)) {
    for (const item of existing) if (normalizeDesc(item.descripcion) === n) out.push({ item, score: 3 });
    return out;
  }

  const tk = tokenSet(desc);
  const rowIsLoan = LOAN_WORDS.test(desc);
  for (const item of existing) {
    const k = normalizeDesc(item.descripcion);
    if (k.startsWith(LOAN_PREFIX)) continue;
    if (k === n) { out.push({ item, score: 3 }); continue; }
    if (rowIsLoan && item.categoria === 'Prestamos') {
      const itk = tokenSet(item.descripcion);
      if (sameSet(tk, itk)) { out.push({ item, score: 2 }); continue; }
      if (tk.size >= 3 && isSubset(tk, itk)) { out.push({ item, score: 1 }); continue; }
    }
    // Último recurso (comportamiento anterior): un nombre es prefijo del otro
    if (k.length >= 4 && n.length >= 4 && (n.startsWith(k) || k.startsWith(n))) out.push({ item, score: 0 });
  }
  return out;
}

/** Mejor vínculo (sin reservar series), cercano a la fecha dada. Se usa en la vista previa. */
export function findCxpMatch(desc: string, existing: CuentaPendiente[], refDate: string | null = null): CuentaPendiente | null {
  return pickBest(findCxpMatches(desc, existing), refDate);
}

function pickBest(cands: Candidate[], venc: string | null): CuentaPendiente | null {
  if (cands.length === 0) return null;
  const dist = (c: CuentaPendiente) => (venc && c.vencimiento ? Math.abs(monthsBetween(c.vencimiento, venc)) : 999);
  return [...cands].sort((a, b) =>
    Number(!!b.item.groupId) - Number(!!a.item.groupId) ||
    b.score - a.score ||
    dist(a.item) - dist(b.item)
  )[0].item;
}

// ── Importación de "Cuentas" → CxP ────────────────────────────────────────────

export interface CxpRowInput {
  descripcion: string;
  tipoPago: PaymentMethod;
  categoria: CategoryType;
  monto: number;
  saldo: number;
  vencimiento: string | null;
  estado: AccountStatus;
}

/** Vencimiento a más de un mes de distancia del mes que se importa: casi seguro un error del Excel. */
export const hasSuspiciousDate = (row: { vencimiento: string | null }, monthStr: string): boolean =>
  !!row.vencimiento && Math.abs(monthsBetween(row.vencimiento, monthStr)) > 1;

/**
 * Convierte las filas del Excel en cuentas por pagar nuevas, enlazándolas a la serie existente
 * (mismo crédito) cuando corresponde. Cada serie se usa una sola vez por mes y ninguna fila se pierde.
 */
export function buildCxpItems(
  rows: CxpRowInput[],
  existing: CuentaPendiente[],
  monthStr: string,
  newId: () => string
): CuentaPendiente[] {
  const claimed = new Set<string>();
  const seen = new Set<string>();
  const out: CuentaPendiente[] = [];

  for (const row of rows) {
    const dupKey = `${row.descripcion}|${row.monto}|${row.vencimiento ?? ''}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);

    const fueraDeMes = hasSuspiciousDate(row, monthStr);
    const cands = findCxpMatches(row.descripcion, existing).filter(c => !claimed.has(claimKey(c.item)));
    const match = pickBest(cands, fueraDeMes || !row.vencimiento ? monthStr : row.vencimiento);
    if (match) claimed.add(claimKey(match));

    // Una fecha lejos del mes (p. ej. "14-mar" en la columna de octubre) es un error de digitación del Excel:
    // se reubica en el mes siguiendo el día de la cuota de la serie, o el mismo día del Excel si no hay serie.
    let vencimiento = row.vencimiento;
    let observaciones = '';
    if (fueraDeMes && row.vencimiento) {
      if (match?.vencimiento) {
        vencimiento = addMonthsIso(match.vencimiento, monthsBetween(match.vencimiento, monthStr));
      } else {
        const dim = new Date(Date.UTC(Number(monthStr.slice(0, 4)), Number(monthStr.slice(5, 7)), 0)).getUTCDate();
        vencimiento = `${monthOf(monthStr)}-${pad(Math.min(Number(row.vencimiento.slice(8, 10)), dim))}`;
      }
      observaciones = `Fecha corregida: el Excel decía ${row.vencimiento}`;
    }

    let descripcion = row.descripcion;
    let cuotaActual: number | undefined;
    let cuotasTotales: number | undefined;
    if (match) {
      descripcion = baseName(match.descripcion);
      const src = parseCuota(match.descripcion);
      const n0 = match.cuotaActual ?? src?.n;
      const total = match.cuotasTotales ?? src?.total;
      if (n0 && total && match.vencimiento && vencimiento) {
        const n1 = n0 + monthsBetween(match.vencimiento, vencimiento);
        if (n1 >= 1 && n1 <= total) {
          cuotaActual = n1;
          cuotasTotales = total;
          descripcion = `${baseName(match.descripcion)} (${n1}/${total})`;
        }
      }
    }

    out.push({
      id: newId(),
      mes: monthStr,
      descripcion,
      tipoPago: row.tipoPago,
      categoria: row.categoria,
      monto: row.monto,
      saldo: row.saldo,
      vencimiento,
      estado: row.estado,
      observaciones,
      ...(cuotaActual ? { cuotaActual, cuotasTotales } : {}),
      ...(match?.groupId ? { groupId: match.groupId } : {}),
    });
  }
  return out;
}

// ── Lectura de la hoja "Prestamos" ────────────────────────────────────────────

type FlagKind = 'vacia' | 'texto' | 'repetida' | 'anio';

export interface PrestamoCuota {
  n: number;            // número de cuota
  monto: number;
  vencimiento: string;  // YYYY-MM-DD
  fila: number;         // fila del Excel (1-based)
  flag?: string;        // corrección o estimación aplicada
  kind?: FlagKind;
}

/** Agrupa las correcciones por tipo para mostrar un aviso corto por préstamo. */
function resumirFlags(cuotas: PrestamoCuota[]): string[] {
  const filas = (xs: PrestamoCuota[]) => (xs.length === 1 ? `fila ${xs[0].fila}` : `filas ${xs[0].fila}–${xs[xs.length - 1].fila}`);
  const por = (k: FlagKind) => cuotas.filter(q => q.kind === k);
  const out: string[] = [];
  const vacia = por('vacia'), texto = por('texto'), rep = por('repetida'), anio = por('anio');
  if (vacia.length) out.push(`${vacia.length} cuota${vacia.length > 1 ? 's' : ''} sin fecha en el Excel (${filas(vacia)}): fecha estimada mes a mes`);
  if (rep.length) out.push(`${rep.length} cuota${rep.length > 1 ? 's' : ''} con la fecha repetida en el Excel (${filas(rep)}): fecha estimada mes a mes`);
  texto.forEach(q => out.push(`fila ${q.fila}: ${q.flag}`));
  anio.forEach(q => out.push(`fila ${q.fila}: ${q.flag}`));
  return out;
}

export interface PrestamoBlock {
  key: string;          // columna del monto (identifica el bloque)
  label: string;        // texto de la fila 1 del Excel
  code: string | null;
  nombre: string;       // descripción base: "Credito Consumo BancoEstado (2279)"
  cuotas: PrestamoCuota[];
  total: number;        // total de cuotas según la numeración del Excel
  avisos: string[];
}

const colName = (c: number): string => {
  let s = '';
  let n = c + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const colIndex = (letters: string): number => letters.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
const cellAt = (ws: WorkSheet, r: number, c: number): any => ws[`${colName(c)}${r + 1}`];

const numAt = (ws: WorkSheet, r: number, c: number): number | null => {
  const x = cellAt(ws, r, c);
  if (!x || x.v == null || typeof x.v !== 'number' || isNaN(x.v)) return null;
  return x.v;
};

const utcIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function dateFromCell(x: any): string | null {
  if (!x || x.v == null) return null;
  if (x.v instanceof Date) {
    const y = x.v.getUTCFullYear();
    // Excel interpreta "23-ene-30" como 1930; en este archivo siempre se refiere a 2030
    if (y >= 1930 && y < 2000) return utcIso(new Date(Date.UTC(y + 100, x.v.getUTCMonth(), x.v.getUTCDate())));
    return y >= 2000 && y < 2100 ? utcIso(x.v) : null;
  }
  if (typeof x.v === 'number' && x.v > 36526 && x.v < 73050) return utcIso(new Date(Math.round((x.v - 25569) * 86400 * 1000)));
  if (typeof x.v === 'string') {
    const s = x.v.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  return null;
}

const SKIP_LABEL = /mensual|periodo|total|resumen/i;

function nombreDesdeLabel(label: string, code: string | null, usados: Map<string, number>): string {
  const sinNumero = (s: string) => s.replace(/\s*[-–]\s*\d{1,3}\s*$/, '').replace(/\s+\d{1,3}\s*$/, '').trim();
  const base = code && /bancoestado|banco estado/i.test(label) ? `Credito Consumo BancoEstado (${code})` : sinNumero(label);
  const veces = (usados.get(base) ?? 0) + 1;
  usados.set(base, veces);
  if (veces === 1) return base;
  const romano = ['', '', 'II', 'III', 'IV', 'V', 'VI'][veces] ?? String(veces);
  return `${base} ${romano}`;
}

/**
 * Cada préstamo es un bloque de 3 columnas (n°, monto, fecha) con el nombre en la fila 1, encima del monto.
 * Solo se toman las cuotas pendientes: monto > 0 y fecha (las pagadas quedan en 0 o vacías).
 */
export function parsePrestamosSheet(ws: WorkSheet, today: string): PrestamoBlock[] {
  const ref = ws['!ref'];
  if (!ref) return [];
  const end = ref.split(':')[1] ?? ref;
  const endM = end.match(/^([A-Z]+)(\d+)$/);
  if (!endM) return [];
  const lastCol = colIndex(endM[1]);
  const lastRow = Number(endM[2]) - 1;

  const blocks: PrestamoBlock[] = [];
  const usados = new Map<string, number>();
  const floor = addMonthsIso(today, -3);

  for (let c = 1; c <= lastCol; c++) {
    const head = cellAt(ws, 0, c);
    if (!head || head.t !== 's' || typeof head.v !== 'string') continue;
    const label = head.v.replace(/\s+/g, ' ').trim();
    if (!label || SKIP_LABEL.test(label)) continue;

    const cuotas: PrestamoCuota[] = [];
    const avisos: string[] = [];
    let ultima: string | null = null;
    let rawPrev: string | null = null;

    for (let r = 1; r <= lastRow; r++) {
      const monto = numAt(ws, r, c);
      if (monto == null || monto <= 0) continue;
      const n = numAt(ws, r, c - 1);
      const dateCell = cellAt(ws, r, c + 1);
      let fecha = dateFromCell(dateCell);
      const raw0 = fecha;
      let flag: string | undefined;
      let kind: FlagKind | undefined;

      if (!fecha) {
        if (n != null && Number.isInteger(n) && n > 0 && ultima) {
          const raw = dateCell?.v == null || String(dateCell.v).trim() === '' ? '' : String(dateCell.v).trim();
          fecha = addMonthsIso(ultima, 1);
          kind = raw ? 'texto' : 'vacia';
          flag = raw ? `fecha estimada (el Excel decía «${raw}»)` : 'fecha estimada (el Excel no traía fecha)';
        } else {
          if (n != null) avisos.push(`fila ${r + 1}: cuota ${n} sin fecha válida, no se importa`);
          continue;
        }
      }

      if (!flag && fecha < floor) {
        for (let k = 1; k <= 3; k++) {
          const cand = addMonthsIso(fecha, 12 * k);
          if (cand >= floor) { kind = 'anio'; flag = `año corregido (el Excel decía ${fecha})`; fecha = cand; break; }
        }
      } else if (!flag && ultima && fecha <= ultima) {
        const cand = addMonthsIso(fecha, 12);
        if (fecha !== rawPrev && cand > ultima && monthsBetween(ultima, cand) <= 1) {
          kind = 'anio'; flag = `año corregido (el Excel decía ${fecha})`; fecha = cand;
        } else {
          kind = 'repetida'; flag = `fecha estimada (el Excel repetía ${fecha})`; fecha = addMonthsIso(ultima, 1);
        }
      }

      ultima = fecha;
      rawPrev = raw0 ?? rawPrev;
      cuotas.push({ n: n ?? 0, monto, vencimiento: fecha, fila: r + 1, flag, kind });
    }

    if (cuotas.length === 0) continue;

    const increasing = cuotas.every((q, i) => q.n > 0 && Number.isInteger(q.n) && (i === 0 || q.n > cuotas[i - 1].n));
    cuotas.forEach((q, i) => { if (!increasing) q.n = i + 1; });
    const total = increasing ? cuotas[cuotas.length - 1].n : cuotas.length;
    avisos.push(...resumirFlags(cuotas));

    const code = loanCode(label);
    blocks.push({ key: colName(c), label, code, nombre: nombreDesdeLabel(label, code, usados), cuotas, total, avisos });
  }
  return blocks;
}

// ── Comparación con el sistema y plan de importación ──────────────────────────

export type PrestamoEstado = 'NUEVO' | 'COMPLETAR' | 'EXISTE';

export interface PrestamoDiff { iguales: number; difieren: number; faltan: number; sobran: number }

export interface PrestamoAnalysis {
  block: PrestamoBlock;
  estado: PrestamoEstado;
  existing: CuentaPendiente[];           // todas las cuotas del sistema para este préstamo
  existingPendientes: CuentaPendiente[]; // las no pagadas
  paidCount: number;
  toAdd: PrestamoCuota[];                // cuotas que "Combinar" agregaría
  diff: PrestamoDiff | null;
}

const sumAbs = (a: number, b: number) => Math.abs(a - b);

function matchExisting(block: PrestamoBlock, cxp: CuentaPendiente[]): CuentaPendiente[] {
  // 1) por código del crédito
  if (block.code) {
    const byCode = cxp.filter(i => loanCode(i.descripcion) === block.code);
    if (byCode.length) return byCode;
  }
  // 2) por nombre (mismas palabras, sin importar el orden)
  const tk = tokenSet(block.nombre);
  const prest = cxp.filter(i => i.categoria === 'Prestamos' && !loanCode(i.descripcion));
  if (!block.code) {
    const eq = prest.filter(i => sameSet(tokenSet(i.descripcion), tk));
    if (eq.length) return eq;
  }
  // 3) por evidencia: alguna cuota con la misma fecha y monto casi igual
  const hits = new Map<string, number>();
  for (const q of block.cuotas) {
    for (const i of cxp) {
      if (i.categoria !== 'Prestamos' || i.vencimiento !== q.vencimiento) continue;
      if (sumAbs(i.monto, q.monto) <= Math.max(1000, q.monto * 0.005)) {
        const k = i.groupId ?? i.id;
        hits.set(k, (hits.get(k) ?? 0) + 1);
      }
    }
  }
  if (hits.size) {
    const best = [...hits.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return cxp.filter(i => (i.groupId ?? i.id) === best);
  }
  return [];
}

export function analyzePrestamos(blocks: PrestamoBlock[], cxp: CuentaPendiente[]): PrestamoAnalysis[] {
  return blocks.map(block => {
    const existing = matchExisting(block, cxp);
    const existingPendientes = existing.filter(i => i.estado !== 'PAGADA');
    const paidCount = existing.length - existingPendientes.length;

    if (existing.length === 0) {
      return { block, estado: 'NUEVO' as const, existing, existingPendientes, paidCount, toAdd: block.cuotas, diff: null };
    }

    const monthsInSystem = new Set(existing.filter(i => i.vencimiento).map(i => monthOf(i.vencimiento!)));
    const toAdd = block.cuotas.filter(q => !monthsInSystem.has(monthOf(q.vencimiento)));

    const pendByMonth = new Map<string, CuentaPendiente>();
    existingPendientes.forEach(i => { if (i.vencimiento) pendByMonth.set(monthOf(i.vencimiento), i); });
    const fileMonths = new Set(block.cuotas.map(q => monthOf(q.vencimiento)));
    let iguales = 0, difieren = 0, faltan = 0;
    for (const q of block.cuotas) {
      const s = pendByMonth.get(monthOf(q.vencimiento));
      if (!s) { faltan++; continue; }
      if (s.vencimiento === q.vencimiento && sumAbs(s.monto, q.monto) <= 5) iguales++; else difieren++;
    }
    const sobran = existingPendientes.filter(i => !i.vencimiento || !fileMonths.has(monthOf(i.vencimiento))).length;

    const estado: PrestamoEstado = existing.length <= 1 && toAdd.length > 0 ? 'COMPLETAR' : 'EXISTE';
    return { block, estado, existing, existingPendientes, paidCount, toAdd, diff: { iguales, difieren, faltan, sobran } };
  });
}

export interface PrestamosPlan {
  insert: CuentaPendiente[];
  deleteIds: string[];
  prestamos: number;
  parciales: number;
}

const mainGroupOf = (items: CuentaPendiente[]): string | undefined => {
  const count = new Map<string, number>();
  items.forEach(i => { if (i.groupId) count.set(i.groupId, (count.get(i.groupId) ?? 0) + 1); });
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

function toCxp(
  nombre: string, q: PrestamoCuota, cuotaActual: number, cuotasTotales: number, groupId: string, newId: () => string
): CuentaPendiente {
  return {
    id: newId(),
    mes: `${monthOf(q.vencimiento)}-01`,
    descripcion: `${nombre} (${cuotaActual}/${cuotasTotales})`,
    tipoPago: 'EFECTIVO',
    categoria: 'Prestamos',
    monto: q.monto,
    saldo: q.monto,
    vencimiento: q.vencimiento,
    estado: 'PENDIENTE',
    observaciones: q.flag ? `Importado del Excel: ${q.flag}` : '',
    cuotaActual,
    cuotasTotales,
    groupId,
  };
}

/**
 * Combinar: agrega los préstamos nuevos (y completa los que solo tienen una cuota suelta). No toca lo existente.
 * Reemplazar: para cada préstamo elegido elimina sus cuotas no pagadas del sistema e importa las del Excel;
 * las cuotas ya pagadas se conservan y la numeración continúa después de ellas.
 */
export function buildPrestamosPlan(
  analyses: PrestamoAnalysis[],
  selected: Set<string>,
  mode: 'merge' | 'replace',
  newId: () => string
): PrestamosPlan {
  const plan: PrestamosPlan = { insert: [], deleteIds: [], prestamos: 0, parciales: 0 };

  for (const a of analyses) {
    if (!selected.has(a.block.key)) continue;
    const { block } = a;

    if (a.estado === 'NUEVO') {
      const gid = newId();
      block.cuotas.forEach(q => plan.insert.push(toCxp(block.nombre, q, q.n, block.total, gid, newId)));
      plan.prestamos++;
      continue;
    }

    if (mode === 'merge') {
      if (a.estado !== 'COMPLETAR') continue;
      const gid = newId();
      a.toAdd.forEach(q => plan.insert.push(toCxp(block.nombre, q, q.n, block.total, gid, newId)));
      plan.prestamos++;
      continue;
    }

    // Reemplazar un préstamo existente
    const nombre = baseName(a.existing.find(i => i.groupId === mainGroupOf(a.existing))?.descripcion ?? a.existing[0].descripcion);
    const gid = mainGroupOf(a.existing) ?? newId();
    const total = a.paidCount + block.cuotas.length;
    block.cuotas.forEach((q, i) => plan.insert.push(toCxp(nombre, q, a.paidCount + i + 1, total, gid, newId)));
    a.existingPendientes.forEach(i => { plan.deleteIds.push(i.id); if (i.estado === 'PARCIAL') plan.parciales++; });
    plan.prestamos++;
  }
  return plan;
}
