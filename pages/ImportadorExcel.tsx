
import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle,
  X, RefreshCw, Clock, ChevronRight, Info
} from 'lucide-react';
import { useStore } from '../store';
import { Cuenta, CuentaPendiente, SaldoDiario, CategoryType, PaymentMethod } from '../types';
import { id as genId, fmt } from '../utils';

// ── Shared helpers ────────────────────────────────────────────────────────────

const MONTHS_ES: Record<string, number> = {
  enero: 0, ene: 0, febrero: 1, feb: 1, marzo: 2, mar: 2,
  abril: 3, abr: 3, mayo: 4, may: 4, junio: 5, jun: 5,
  julio: 6, jul: 6, agosto: 7, ago: 7, septiembre: 8, sep: 8, sept: 8,
  octubre: 9, oct: 9, noviembre: 10, nov: 10, diciembre: 11, dic: 11,
};

function parseMonthHeader(text: string): string | null {
  if (!text) return null;
  const m = text.toLowerCase().match(/(\w+)\s+(\d{4})/);
  if (!m) return null;
  const monthNum = MONTHS_ES[m[1]];
  if (monthNum === undefined) return null;
  return dayjs(new Date(parseInt(m[2]), monthNum, 1)).format('YYYY-MM-01');
}

function cellStr(ws: XLSX.WorkSheet, r: number, c: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v == null) return '';
  return String(cell.v).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function colLetter(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellNum(ws: XLSX.WorkSheet, r: number, c: number): number {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v == null) return 0;
  const n = Number(cell.v);
  return isNaN(n) ? 0 : n;
}

function utcDateStr(d: Date): string {
  // SheetJS produces UTC-midnight Date objects; use UTC methods to avoid timezone shift
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cellDate(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || !cell.v) return null;
  if (cell.t === 'd' && cell.v instanceof Date) return utcDateStr(cell.v);
  if (typeof cell.v === 'number') {
    const d = new Date(Math.round((cell.v - 25569) * 86400 * 1000));
    const s = utcDateStr(d);
    return s.startsWith('1') || s.startsWith('2') ? s : null;
  }
  const str = String(cell.v).trim();
  for (const f of ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'D/M/YYYY', 'D/M/YY', 'D-MMM-YY', 'D-MMM-YYYY', 'D-MMM']) {
    const d = dayjs(str, f);
    if (d.isValid() && d.year() > 1970) return d.format('YYYY-MM-DD');
  }
  return null;
}

function isHiddenRow(ws: XLSX.WorkSheet, r: number): boolean {
  return ws['!rows']?.[r]?.hidden === true;
}

// ── CxP helpers ───────────────────────────────────────────────────────────────

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\s*\([^)]+\)/g, '')  // strip "(0227...6125)", "(3/33)", etc.
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCategoria(desc: string): CategoryType {
  const d = desc.toLowerCase();
  if (/credito|crédito|prestamo|préstamo/.test(d)) return 'Prestamos';
  if (/visa|mastercard|\bmc\b|\bvi\b|cmr|ripley|cencosud|falabella|lider|tarjeta/.test(d)) return 'Tarjeta de credito';
  if (/\btag\b|televia/.test(d)) return 'Tag';
  if (/seguro/.test(d)) return 'Seguros';
  if (/dividendo|arriendo|gastos comun|santa teresa|cataluña/.test(d)) return 'Gastos Casa';
  if (/movistar|entel|claro|vtr|internet|celular|net2phone|webworks|taxicab|akikb/.test(d)) return 'Gastos Operacionales';
  return 'Otros';
}

interface MonthGroup {
  monthStr: string;
  label: string;
  colDeuda: number;
  colVcmto: number;
  colPorPagar: number;
  headerRow: number;
}

function detectMonthGroups(ws: XLSX.WorkSheet): MonthGroup[] {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z100');
  const groups: MonthGroup[] = [];
  const seen = new Set<string>();

  for (let r = range.s.r; r <= Math.min(range.e.r, 10); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const val = cellStr(ws, r, c);
      const monthDate = parseMonthHeader(val);
      if (!monthDate || seen.has(monthDate)) continue;

      for (let dr = 1; dr <= 4; dr++) {
        const subRow = r + dr;
        let colDeuda = -1, colVcmto = -1, colPorPagar = -1;
        // Scan left-to-right and stop at FIRST match for each header.
        // Without this, adjacent month sections (e.g. "Abril" to the right of "Mayo")
        // would overwrite the correct column indices with the wrong month's columns.
        for (let dc = -2; dc <= 14; dc++) {
          // cellStr already normalizes newlines/spaces, plus strip dots
          const sub = cellStr(ws, subRow, c + dc).toLowerCase().replace(/\./g, '').trim();
          if (sub === 'deuda' && colDeuda < 0) colDeuda = c + dc;
          else if ((sub.startsWith('vcmto') || sub.startsWith('vencim')) && colVcmto < 0) colVcmto = c + dc;
          else if ((sub === 'por pagar' || sub === 'x pagar') && colPorPagar < 0) colPorPagar = c + dc;
          if (colDeuda >= 0 && colVcmto >= 0 && colPorPagar >= 0) break;
        }
        if (colDeuda >= 0 && colVcmto >= 0) {
          // If "Por pagar" header wasn't found, assume it sits right after Vcmto
          if (colPorPagar < 0) colPorPagar = colVcmto + 1;
          groups.push({ monthStr: monthDate, label: val, colDeuda, colVcmto, colPorPagar, headerRow: subRow });
          seen.add(monthDate);
          break;
        }
      }
    }
  }
  return groups.sort((a, b) => b.monthStr.localeCompare(a.monthStr));
}

interface ParsedCxPRow {
  descripcion: string;
  tipoPago: PaymentMethod;
  monto: number;
  saldo: number;
  vencimiento: string | null;
  estado: 'PENDIENTE' | 'PAGADA' | 'PARCIAL';
  categoria: CategoryType;
}

function parseCuentasSheet(ws: XLSX.WorkSheet, group: MonthGroup): ParsedCxPRow[] {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z100');
  const results: ParsedCxPRow[] = [];
  const groupYear = parseInt(group.monthStr.substring(0, 4));

  for (let r = group.headerRow + 1; r <= range.e.r; r++) {
    if (isHiddenRow(ws, r)) continue;
    const desc = cellStr(ws, r, 0);
    if (!desc || desc.length < 2) continue;
    const tipoPagoRaw = cellStr(ws, r, 1).toUpperCase();
    if (tipoPagoRaw !== 'TC' && tipoPagoRaw !== 'EF') continue;

    const monto = cellNum(ws, r, group.colDeuda);
    if (monto <= 0) continue;

    let vencimiento = cellDate(ws, r, group.colVcmto);
    if (vencimiento) {
      const d = dayjs(vencimiento);
      // Always force the group year — Excel templates often carry stale years
      if (d.isValid() && d.year() !== groupYear)
        vencimiento = d.year(groupYear).format('YYYY-MM-DD');
    }

    const porPagar = Math.max(0, cellNum(ws, r, group.colPorPagar)); // ignore negatives
    const estado: 'PENDIENTE' | 'PAGADA' | 'PARCIAL' =
      porPagar <= 0 ? 'PAGADA' : porPagar < monto ? 'PARCIAL' : 'PENDIENTE';

    results.push({
      descripcion: desc,
      tipoPago: tipoPagoRaw === 'TC' ? 'TARJETA_CREDITO' : 'EFECTIVO',
      monto, saldo: porPagar, vencimiento, estado,
      categoria: detectCategoria(desc),
    });
  }
  return results;
}

// ── Actual (Saldos) helpers ───────────────────────────────────────────────────

interface ActualCol {
  colIdx: number;
  label: string;     // "Itaú COF"
  subLabel: string;  // card number "2853..0029" or ""
  type: 'CC' | 'TC';
  cuentaId: string;  // "" = skip
}

function fuzzyMatchCuenta(label: string, subLabel: string, cuentas: Cuenta[], tipo: 'CC' | 'TARJETA'): string {
  const l = label.toLowerCase().replace(/cof|rmovil|radiomovil|\./gi, '').trim();
  const num = subLabel.replace(/\./g, '').replace(/\.\./g, '').trim();
  const candidates = cuentas.filter(c => c.tipo === tipo && c.activo);

  // Match by card number first
  if (num) {
    for (const c of candidates) {
      if (c.numeroRef && num.includes(c.numeroRef.replace(/\./g, ''))) return c.id;
      if (c.numeroRef && c.numeroRef.replace(/\./g, '').includes(num.replace(/\./g, ''))) return c.id;
    }
  }

  // Match by bank name substring
  for (const c of candidates) {
    const banco = c.banco.toLowerCase().replace(/cof|rmovil|radiomovil|\./gi, '').trim();
    if (l.includes(banco) || banco.includes(l.split(' ')[0])) return c.id;
    // Specific mappings
    if (l.includes('itau') && banco.includes('itau')) return c.id;
    if (l.includes('chile') && banco.includes('chile')) return c.id;
    if ((l.includes('officebank') || l.includes('office')) && banco.includes('office')) return c.id;
    if ((l.includes('bcoestad') || l.includes('bcoestado') || l.includes('bcoestado')) && banco.includes('estado')) return c.id;
    if (l.includes('scot') && banco.includes('scot')) return c.id;
    if (l.includes('lider') && banco.includes('lider')) return c.id;
    if (l.includes('ripley') && banco.includes('ripley')) return c.id;
    if (l.includes('falabella') && banco.includes('falabella')) return c.id;
    if (l.includes('cmr') && banco.includes('cmr')) return c.id;
  }
  return '';
}

function detectActualStructure(ws: XLSX.WorkSheet, cuentas: Cuenta[]): { cols: ActualCol[], dateRows: { rowIdx: number, fecha: string }[] } {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z100');

  // Find TOTAL and DISPONI. columns scanning first 5 rows
  let colTotal = -1, colDisponi = -1, headerRow = 0;
  for (let r = 0; r <= Math.min(range.e.r, 5) && (colTotal < 0 || colDisponi < 0); r++) {
    for (let c = 1; c <= range.e.c; c++) {
      const v = cellStr(ws, r, c).toLowerCase().replace(/\./g, '').trim();
      if ((v === 'total' || v === 'subtotal') && colTotal < 0) { colTotal = c; headerRow = r; }
      if (v.startsWith('disponi') && colDisponi < 0) colDisponi = c;
    }
  }

  if (colTotal < 0) return { cols: [], dateRows: [] };

  const subHeaderRow = headerRow + 1;
  const cols: ActualCol[] = [];

  // CC columns: col 1 to colTotal-1 (skip pure-sum or 'deposito' columns)
  for (let c = 1; c < colTotal; c++) {
    const label = cellStr(ws, headerRow, c);
    if (!label) continue;
    const lv = label.toLowerCase();
    if (lv.includes('subtotal') || lv.includes('deposito') || lv === 'total') continue;
    const subLabel = cellStr(ws, subHeaderRow, c);
    cols.push({
      colIdx: c, label, subLabel, type: 'CC',
      cuentaId: fuzzyMatchCuenta(label, subLabel, cuentas, 'CC'),
    });
  }

  // TC columns: colTotal+1 to colDisponi-1
  if (colDisponi > 0) {
    for (let c = colTotal + 1; c < colDisponi; c++) {
      const label = cellStr(ws, headerRow, c);
      if (!label) continue;
      const subLabel = cellStr(ws, subHeaderRow, c);
      cols.push({
        colIdx: c, label, subLabel, type: 'TC',
        cuentaId: fuzzyMatchCuenta(label, subLabel, cuentas, 'TARJETA'),
      });
    }
  }

  // Date rows: column 0 has dates, starting after header rows
  const dateRows: { rowIdx: number, fecha: string }[] = [];
  for (let r = subHeaderRow + 1; r <= range.e.r; r++) {
    if (isHiddenRow(ws, r)) continue;
    const fecha = cellDate(ws, r, 0);
    if (!fecha) continue;
    dateRows.push({ rowIdx: r, fecha });
  }

  return { cols, dateRows };
}

// ── Component ─────────────────────────────────────────────────────────────────

type ActiveTab = 'cuentas' | 'prestamos' | 'actual';

export default function ImportadorExcel() {
  const { cxp, cuentas, saldos, importCxPFromExcel, importSaldosFromExcel } = useStore();

  // Shared
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('cuentas');
  const [error, setError] = useState('');

  // CxP tab
  const [monthGroups, setMonthGroups] = useState<MonthGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<MonthGroup | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedCxPRow[]>([]);
  const [cxpConflict, setCxpConflict] = useState<'replace' | 'merge'>('replace');
  const [cxpImporting, setCxpImporting] = useState(false);
  const [cxpDone, setCxpDone] = useState(false);

  // Actual tab
  const [actualCols, setActualCols] = useState<ActualCol[]>([]);
  const [actualDateRows, setActualDateRows] = useState<{ rowIdx: number, fecha: string }[]>([]);
  const [actualConflict, setActualConflict] = useState<'replace' | 'merge'>('replace');
  const [actualImporting, setActualImporting] = useState(false);
  const [actualDone, setActualDone] = useState(false);
  const [actualError, setActualError] = useState('');

  const existingForMonth = selectedGroup ? cxp.filter(i => i.mes === selectedGroup.monthStr) : [];

  const getWs = (hints: string[]) => {
    if (!workbook) return null;
    const name = workbook.SheetNames.find(n => hints.some(h => n.toLowerCase().includes(h)));
    return name ? workbook.Sheets[name] : workbook.Sheets[workbook.SheetNames[0]];
  };

  // ── File load ──────────────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    setError(''); setCxpDone(false); setActualDone(false); setActualError('');
    setParsedRows([]); setSelectedGroup(null); setMonthGroups([]);
    setActualCols([]); setActualDateRows([]); setWorkbook(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array', cellDates: true });
        setWorkbook(wb);
        setFileName(file.name);

        const wsCuentas = wb.Sheets[wb.SheetNames.find(n => n.toLowerCase().includes('cuenta') || n.toLowerCase().includes('cxp')) || wb.SheetNames[0]];
        if (wsCuentas) {
          const groups = detectMonthGroups(wsCuentas);
          setMonthGroups(groups);
          if (groups.length > 0) { setSelectedGroup(groups[0]); setParsedRows(parseCuentasSheet(wsCuentas, groups[0])); }
        }
      } catch { setError('No se pudo leer el archivo. Asegúrate de que sea un .xlsx o .xls válido.'); }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── Tab switch ─────────────────────────────────────────────────────────────
  const handleTabClick = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === 'actual' && workbook && actualCols.length === 0) {
      const wsActual = workbook.Sheets[workbook.SheetNames.find(n => n.toLowerCase().includes('actual')) || ''];
      if (!wsActual) { setActualError('No se encontró pestaña "Actual" en el archivo.'); return; }
      const { cols, dateRows } = detectActualStructure(wsActual, cuentas);
      if (cols.length === 0) { setActualError('No se pudo detectar la estructura de la pestaña Actual. Verifica que tenga columna TOTAL y DISPONI.'); return; }
      setActualCols(cols);
      setActualDateRows(dateRows);
    }
  };

  // ── CxP handlers ──────────────────────────────────────────────────────────
  const handleSelectMonth = (group: MonthGroup) => {
    const ws = getWs(['cuenta', 'cxp']);
    if (!ws) return;
    setSelectedGroup(group);
    setParsedRows(parseCuentasSheet(ws, group));
    setCxpDone(false);
  };

  const handleCxpImport = async () => {
    if (!selectedGroup || parsedRows.length === 0) return;
    setCxpImporting(true);
    // Build a match map: normalizedDesc → existing cxp item (any month)
    const existingByNorm = new Map<string, CuentaPendiente>();
    for (const item of cxp) {
      const key = normalizeDesc(item.descripcion);
      if (!existingByNorm.has(key)) existingByNorm.set(key, item);
    }
    const findMatch = (desc: string, venc: string | null) => {
      const n = normalizeDesc(desc);
      // Exact normalized match
      if (existingByNorm.has(n)) return existingByNorm.get(n)!;
      // Prefix match (Excel has "Falabella Michelle (0227)" → webapp has "Falabella Michelle")
      for (const [k, v] of existingByNorm) {
        if (n.startsWith(k) || k.startsWith(n)) return v;
      }
      return null;
    };

    const items: CuentaPendiente[] = parsedRows.map(row => {
      const match = findMatch(row.descripcion, row.vencimiento);
      return {
        // Reuse existing id+groupId when match found, so webapp history is preserved
        id: match?.id ?? genId(),
        mes: selectedGroup.monthStr,
        descripcion: match?.descripcion ?? row.descripcion,
        tipoPago: row.tipoPago,
        categoria: row.categoria,
        monto: row.monto,
        saldo: row.saldo,
        vencimiento: row.vencimiento,
        estado: row.estado,
        observaciones: match?.observaciones ?? '',
        ...(match?.groupId ? { groupId: match.groupId } : {}),
        ...(match?.cuotaActual ? { cuotaActual: match.cuotaActual, cuotasTotales: match.cuotasTotales } : {}),
      };
    });
    await importCxPFromExcel(selectedGroup.monthStr, items, cxpConflict);
    setCxpImporting(false); setCxpDone(true);
  };

  // ── Actual handlers ────────────────────────────────────────────────────────
  const updateActualColCuenta = (colIdx: number, cuentaId: string) => {
    setActualCols(prev => prev.map(c => c.colIdx === colIdx ? { ...c, cuentaId } : c));
  };

  const handleActualImport = async () => {
    const wsActual = workbook?.Sheets[workbook.SheetNames.find(n => n.toLowerCase().includes('actual')) || ''];
    if (!wsActual) return;
    setActualImporting(true);
    setActualError('');
    const today = dayjs().format('YYYY-MM-DD');
    const mappedCols = actualCols.filter(c => c.cuentaId !== '');
    if (mappedCols.length === 0) {
      setActualError('No hay cuentas mapeadas. Selecciona al menos una cuenta en la tabla de abajo.');
      setActualImporting(false); return;
    }
    const items: SaldoDiario[] = [];
    for (const { rowIdx, fecha } of actualDateRows.filter(d => d.fecha <= today)) {
      for (const col of mappedCols) {
        items.push({ id: genId(), fecha, cuentaId: col.cuentaId, saldo: cellNum(wsActual, rowIdx, col.colIdx) });
      }
    }
    if (items.length === 0) {
      setActualError('No se generaron registros. Verifica que el Excel tenga fechas anteriores o iguales a hoy.');
      setActualImporting(false); return;
    }
    await importSaldosFromExcel(items, actualConflict);
    setActualImporting(false); setActualDone(true);
  };

  const reset = () => {
    setWorkbook(null); setFileName(''); setMonthGroups([]); setSelectedGroup(null);
    setParsedRows([]); setCxpDone(false); setActualCols([]); setActualDateRows([]);
    setActualDone(false); setActualError(''); setError('');
  };

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: 'cuentas', label: 'Cuentas → CxP' },
    { id: 'prestamos', label: 'Préstamos → CxP' },
    { id: 'actual', label: 'Actual → Saldos' },
  ];

  const ccCuentas = cuentas.filter(c => c.tipo === 'CC' && c.activo);
  const tcCuentas = cuentas.filter(c => c.tipo === 'TARJETA' && c.activo);
  const mappedCount = actualCols.filter(c => c.cuentaId !== '').length;

  // Count existing saldos for the detected date range
  const detectedDates = new Set(actualDateRows.map(d => d.fecha));
  const existingSaldosCount = saldos.filter(s => detectedDates.has(s.fecha)).length;

  return (
    <div className="space-y-6">

      {/* Upload zone */}
      {!workbook ? (
        <div
          onDrop={handleDrop} onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer"
          onClick={() => document.getElementById('excel-input')?.click()}
        >
          <input id="excel-input" type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <Upload className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-lg font-bold text-slate-600">Arrastra el Excel aquí o haz clic para elegirlo</p>
          <p className="text-sm text-slate-400 mt-1">Soporta .xlsx y .xls</p>
          {error && <div className="mt-4 flex items-center gap-2 justify-center text-red-600 text-sm font-medium"><AlertTriangle className="w-4 h-4" />{error}</div>}
        </div>
      ) : (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <span className="font-bold text-emerald-800 text-sm">{fileName}</span>
            <span className="text-xs text-emerald-600">{workbook.SheetNames.length} pestañas: {workbook.SheetNames.join(', ')}</span>
          </div>
          <button onClick={reset} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      {workbook && (
        <div className="flex gap-2 border-b border-slate-200">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => handleTabClick(tab.id)}
              className={`px-5 py-2.5 text-sm font-bold rounded-t-xl transition-all border-b-2 ${activeTab === tab.id ? 'bg-blue-600 text-white border-blue-600' : 'text-slate-500 border-transparent hover:bg-slate-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── CxP tab ─────────────────────────────────────────────────────────── */}
      {workbook && activeTab === 'cuentas' && (
        <div className="space-y-5">
          {monthGroups.length === 0 ? (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">No se encontraron meses en la pestaña Cuentas.</p>
                <p className="mt-1">Verifica que la hoja contenga una fila con el nombre del mes (ej: "Mayo 2026") y debajo los encabezados "Deuda", "Vcmto." y "Por pagar".</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Selecciona el mes a importar</p>
              <div className="flex flex-wrap gap-2">
                {monthGroups.map(g => (
                  <button key={g.monthStr} onClick={() => handleSelectMonth(g)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${selectedGroup?.monthStr === g.monthStr ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedGroup && (
            <div className="text-[10px] text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 font-mono">
              Cols detectadas: Deuda={colLetter(selectedGroup.colDeuda)} · Vcmto={colLetter(selectedGroup.colVcmto)} · Por pagar={colLetter(selectedGroup.colPorPagar)} · Fila subheader={selectedGroup.headerRow + 1}
            </div>
          )}

          {parsedRows.length > 0 && selectedGroup && (
            <div className="space-y-4">
              {(() => {
                // Build match map for preview
                const previewMatchMap = new Map<string, CuentaPendiente>();
                for (const item of cxp) {
                  const k = normalizeDesc(item.descripcion);
                  if (!previewMatchMap.has(k)) previewMatchMap.set(k, item);
                }
                const getPreviewMatch = (desc: string) => {
                  const n = normalizeDesc(desc);
                  if (previewMatchMap.has(n)) return previewMatchMap.get(n)!;
                  for (const [k, v] of previewMatchMap) {
                    if (n.startsWith(k) || k.startsWith(n)) return v;
                  }
                  return null;
                };
                const matchCount = parsedRows.filter(r => getPreviewMatch(r.descripcion)).length;
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Vista previa — {parsedRows.length} registros en {selectedGroup.label}</p>
                      <span className="text-xs text-slate-400 flex items-center gap-2">
                        <span className="text-blue-600 font-bold">{matchCount} enlazadas</span>
                        <span className="text-emerald-600 font-bold">{parsedRows.length - matchCount} nuevas</span>
                      </span>
                    </div>
                    <div className="overflow-auto max-h-72 rounded-xl border border-slate-200">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>{['', 'Descripción', 'Tipo', 'Cat.', 'Deuda', 'Vcmto.', 'Por Pagar', 'Estado'].map(h => (
                            <th key={h} className="text-left px-3 py-2 font-bold text-slate-500 border-b border-slate-200 whitespace-nowrap">{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {parsedRows.map((row, i) => {
                            const match = getPreviewMatch(row.descripcion);
                            return (
                              <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 ${match ? 'bg-blue-50/40' : ''}`}>
                                <td className="px-3 py-2">
                                  {match
                                    ? <span className="px-1.5 py-0.5 rounded font-bold text-[9px] bg-blue-100 text-blue-700 whitespace-nowrap">↔ ENLAZA</span>
                                    : <span className="px-1.5 py-0.5 rounded font-bold text-[9px] bg-emerald-100 text-emerald-700">+ NUEVO</span>}
                                </td>
                                <td className="px-3 py-2 font-medium text-slate-700 max-w-[180px]">
                                  <div className="truncate">{row.descripcion}</div>
                                  {match && match.descripcion !== row.descripcion && (
                                    <div className="text-blue-500 text-[9px] truncate">→ {match.descripcion}</div>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${row.tipoPago === 'TARJETA_CREDITO' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {row.tipoPago === 'TARJETA_CREDITO' ? 'TC' : 'EF'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-500 text-[10px]">{row.categoria}</td>
                                <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(row.monto)}</td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.vencimiento ?? '—'}</td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">{fmt(row.saldo)}</td>
                                <td className="px-3 py-2">
                                  <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${row.estado === 'PAGADA' ? 'bg-emerald-100 text-emerald-700' : row.estado === 'PARCIAL' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{row.estado}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}

              {existingForMonth.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-sm"><AlertTriangle className="w-4 h-4" />Ya existen {existingForMonth.length} registros para {selectedGroup.label}</div>
                  <div className="space-y-2">
                    {(['replace', 'merge'] as const).map(mode => (
                      <label key={mode} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${cxpConflict === mode ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <input type="radio" name="cxp-conflict" value={mode} checked={cxpConflict === mode} onChange={() => setCxpConflict(mode)} className="mt-0.5" />
                        <div>
                          <p className="font-bold text-sm text-slate-800">{mode === 'replace' ? 'Reemplazar todo' : 'Combinar (agregar nuevos)'}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{mode === 'replace' ? `Elimina los ${existingForMonth.length} registros actuales e importa los ${parsedRows.length} del Excel.` : 'Importa solo los registros nuevos (por descripción). Los existentes no se modifican.'}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {cxpDone ? (
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-800 font-bold">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />¡Importación completada! {parsedRows.length} registros de {selectedGroup.label} en Cuentas por Pagar.
                </div>
              ) : (
                <button onClick={handleCxpImport} disabled={cxpImporting}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {cxpImporting ? <><RefreshCw className="w-4 h-4 animate-spin" />Importando...</> : <><ChevronRight className="w-4 h-4" />Importar {parsedRows.length} registros a CxP</>}
                </button>
              )}
            </div>
          )}

          {parsedRows.length === 0 && selectedGroup && monthGroups.length > 0 && (
            <div className="flex items-center gap-2 text-slate-500 text-sm bg-slate-50 rounded-xl p-4">
              <AlertTriangle className="w-4 h-4" />No se encontraron filas válidas. Deben tener descripción en columna A y TC/EF en columna B.
            </div>
          )}
        </div>
      )}

      {/* ── Actual tab ──────────────────────────────────────────────────────── */}
      {workbook && activeTab === 'actual' && (
        <div className="space-y-5">
          {actualError ? (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><p>{actualError}</p>
            </div>
          ) : actualCols.length === 0 ? (
            <div className="flex items-center gap-3 text-slate-400 text-sm p-4"><RefreshCw className="w-4 h-4 animate-spin" />Detectando estructura...</div>
          ) : (
            <>
              {/* Summary bar */}
              <div className="flex items-center gap-6 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 text-sm">
                <span className="font-bold text-blue-800">{actualDateRows.length} fechas detectadas</span>
                <span className="text-blue-600">{actualCols.filter(c => c.type === 'CC').length} cuentas CC · {actualCols.filter(c => c.type === 'TC').length} tarjetas TC</span>
                {actualDateRows.length > 0 && (
                  <span className="text-blue-500">{actualDateRows[0].fecha} → {actualDateRows[actualDateRows.length - 1].fecha}</span>
                )}
                <span className="ml-auto font-bold text-blue-700">{mappedCount} columnas mapeadas</span>
              </div>

              {/* CC columns */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Cuentas Corrientes (CC) — mapeadas a Cuenta webapp</p>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-4 py-2 font-bold text-slate-500 border-b border-slate-200">Columna Excel</th>
                        <th className="text-left px-4 py-2 font-bold text-slate-500 border-b border-slate-200">Cuenta en webapp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actualCols.filter(c => c.type === 'CC').map(col => (
                        <tr key={col.colIdx} className="border-b border-slate-100">
                          <td className="px-4 py-2">
                            <p className="font-medium text-slate-800">{col.label}</p>
                            {col.subLabel && <p className="text-xs text-slate-400">{col.subLabel}</p>}
                          </td>
                          <td className="px-4 py-2">
                            <select
                              value={col.cuentaId}
                              onChange={e => updateActualColCuenta(col.colIdx, e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                              <option value="">— Omitir esta columna —</option>
                              {ccCuentas.map(c => (
                                <option key={c.id} value={c.id}>{c.banco} {c.nombre} {c.numeroRef ? `(${c.numeroRef})` : ''}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* TC columns */}
              {actualCols.filter(c => c.type === 'TC').length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Tarjetas de Crédito (TC) — mapeadas a Cuenta webapp</p>
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left px-4 py-2 font-bold text-slate-500 border-b border-slate-200">Columna Excel</th>
                          <th className="text-left px-4 py-2 font-bold text-slate-500 border-b border-slate-200">Cuenta en webapp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {actualCols.filter(c => c.type === 'TC').map(col => (
                          <tr key={col.colIdx} className="border-b border-slate-100">
                            <td className="px-4 py-2">
                              <p className="font-medium text-slate-800">{col.label}</p>
                              {col.subLabel && <p className="text-xs text-slate-400">{col.subLabel}</p>}
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={col.cuentaId}
                                onChange={e => updateActualColCuenta(col.colIdx, e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                              >
                                <option value="">— Omitir esta columna —</option>
                                {tcCuentas.map(c => (
                                  <option key={c.id} value={c.id}>{c.banco} {c.nombre} {c.numeroRef ? `(${c.numeroRef})` : ''}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Conflict */}
              {existingSaldosCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-sm"><AlertTriangle className="w-4 h-4" />Ya existen {existingSaldosCount} registros de saldo para estas fechas</div>
                  <div className="space-y-2">
                    {(['replace', 'merge'] as const).map(mode => (
                      <label key={mode} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${actualConflict === mode ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <input type="radio" name="actual-conflict" value={mode} checked={actualConflict === mode} onChange={() => setActualConflict(mode)} className="mt-0.5" />
                        <div>
                          <p className="font-bold text-sm text-slate-800">{mode === 'replace' ? 'Reemplazar' : 'Combinar (agregar nuevos)'}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{mode === 'replace' ? 'Elimina los saldos existentes para las fechas detectadas e importa los del Excel.' : 'Solo agrega fecha+cuenta combos nuevos. Los existentes no se tocan.'}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Import button */}
              {actualDone ? (
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-800 font-bold">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />¡Importación completada! {actualDateRows.length * mappedCount} registros de saldo guardados.
                </div>
              ) : (
                <button onClick={handleActualImport} disabled={actualImporting || mappedCount === 0}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {actualImporting
                    ? <><RefreshCw className="w-4 h-4 animate-spin" />Importando...</>
                    : <><ChevronRight className="w-4 h-4" />Importar {actualDateRows.length * mappedCount} registros de saldo ({mappedCount} cuentas × {actualDateRows.length} fechas)</>}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Prestamos tab ────────────────────────────────────────────────────── */}
      {workbook && activeTab === 'prestamos' && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center">
            <Clock className="w-7 h-7 text-slate-400" />
          </div>
          <div>
            <p className="font-bold text-slate-700 text-lg">Próximamente</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs">Importación de cuotas de préstamos desde la pestaña Préstamos.</p>
          </div>
        </div>
      )}
    </div>
  );
}
