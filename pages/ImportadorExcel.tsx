
import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle,
  X, RefreshCw, Clock, ChevronRight, Info
} from 'lucide-react';
import { useStore } from '../store';
import { CuentaPendiente, CategoryType, PaymentMethod } from '../types';
import { id as genId, fmt, getMonthName } from '../utils';

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  return String(cell.v).trim();
}

function cellNum(ws: XLSX.WorkSheet, r: number, c: number): number {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v == null) return 0;
  const n = Number(cell.v);
  return isNaN(n) ? 0 : n;
}

function cellDate(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || !cell.v) return null;
  if (cell.t === 'd' && cell.v instanceof Date) return dayjs(cell.v).format('YYYY-MM-DD');
  if (typeof cell.v === 'number') {
    // Excel serial date → JS date
    const d = dayjs(new Date(Math.round((cell.v - 25569) * 86400 * 1000)));
    return d.isValid() ? d.format('YYYY-MM-DD') : null;
  }
  const str = String(cell.v).trim();
  for (const f of ['DD-MM-YYYY', 'YYYY-MM-DD', 'D/M/YYYY', 'D-MMM-YY', 'D-MMM']) {
    const d = dayjs(str, f);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return null;
}

function isHiddenRow(ws: XLSX.WorkSheet, r: number): boolean {
  return ws['!rows']?.[r]?.hidden === true;
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
  monthStr: string; // "2026-05-01"
  label: string;    // "Mayo 2026"
  colDeuda: number;
  colVcmto: number;
  colPorPagar: number;
  headerRow: number; // row index of "Deuda"/"Vcmto"/"Por pagar"
}

function detectMonthGroups(ws: XLSX.WorkSheet): MonthGroup[] {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z100');
  const groups: MonthGroup[] = [];
  const seen = new Set<string>();

  // Scan first 10 rows for month names
  for (let r = range.s.r; r <= Math.min(range.e.r, 10); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const val = cellStr(ws, r, c);
      const monthDate = parseMonthHeader(val);
      if (!monthDate || seen.has(monthDate)) continue;

      // Look 1-3 rows below for "Deuda" sub-header
      for (let dr = 1; dr <= 4; dr++) {
        const subRow = r + dr;
        let colDeuda = -1, colVcmto = -1, colPorPagar = -1;

        for (let dc = -2; dc <= 12; dc++) {
          const sub = cellStr(ws, subRow, c + dc).toLowerCase().replace(/\./g, '').trim();
          if (sub === 'deuda') colDeuda = c + dc;
          else if (sub.startsWith('vcmto') || sub.startsWith('vencim')) colVcmto = c + dc;
          else if (sub === 'por pagar' || sub === 'x pagar') colPorPagar = c + dc;
        }

        if (colDeuda >= 0 && colVcmto >= 0 && colPorPagar >= 0) {
          groups.push({ monthStr: monthDate, label: val, colDeuda, colVcmto, colPorPagar, headerRow: subRow });
          seen.add(monthDate);
          break;
        }
      }
    }
  }

  // Sort by date descending (most recent first)
  return groups.sort((a, b) => b.monthStr.localeCompare(a.monthStr));
}

interface ParsedRow {
  descripcion: string;
  tipoPago: PaymentMethod;
  monto: number;
  saldo: number;
  vencimiento: string | null;
  estado: 'PENDIENTE' | 'PAGADA' | 'PARCIAL';
  categoria: CategoryType;
}

function parseCuentasSheet(ws: XLSX.WorkSheet, group: MonthGroup): ParsedRow[] {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z100');
  const results: ParsedRow[] = [];
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
      if (d.isValid() && d.year() !== groupYear && Math.abs(d.year() - groupYear) <= 1) {
        vencimiento = d.year(groupYear).format('YYYY-MM-DD');
      }
    }

    const porPagar = cellNum(ws, r, group.colPorPagar);
    const estado: 'PENDIENTE' | 'PAGADA' | 'PARCIAL' =
      porPagar <= 0 ? 'PAGADA' : porPagar < monto ? 'PARCIAL' : 'PENDIENTE';

    results.push({
      descripcion: desc,
      tipoPago: tipoPagoRaw === 'TC' ? 'TARJETA_CREDITO' : 'EFECTIVO',
      monto,
      saldo: porPagar,
      vencimiento,
      estado,
      categoria: detectCategoria(desc),
    });
  }
  return results;
}

// ── Component ────────────────────────────────────────────────────────────────

type ActiveTab = 'cuentas' | 'prestamos' | 'actual';

export default function ImportadorExcel() {
  const { cxp, importCxPFromExcel } = useStore();

  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('cuentas');
  const [monthGroups, setMonthGroups] = useState<MonthGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<MonthGroup | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [conflictMode, setConflictMode] = useState<'replace' | 'merge'>('replace');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const existingForMonth = selectedGroup
    ? cxp.filter(i => i.mes === selectedGroup.monthStr)
    : [];

  const handleFile = useCallback((file: File) => {
    setError('');
    setDone(false);
    setParsedRows([]);
    setSelectedGroup(null);
    setMonthGroups([]);
    setWorkbook(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        setWorkbook(wb);
        setFileName(file.name);

        // Auto-detect Cuentas sheet
        const sheetName = wb.SheetNames.find(n =>
          n.toLowerCase().includes('cuenta') || n.toLowerCase().includes('cxp')
        ) || wb.SheetNames[0];

        if (sheetName) {
          const ws = wb.Sheets[sheetName];
          const groups = detectMonthGroups(ws);
          setMonthGroups(groups);
          if (groups.length > 0) {
            setSelectedGroup(groups[0]);
            setParsedRows(parseCuentasSheet(ws, groups[0]));
          }
        }
      } catch (err: any) {
        setError('No se pudo leer el archivo. Asegúrate de que sea un .xlsx o .xls válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSelectMonth = (group: MonthGroup) => {
    if (!workbook) return;
    const sheetName = workbook.SheetNames.find(n =>
      n.toLowerCase().includes('cuenta') || n.toLowerCase().includes('cxp')
    ) || workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    setSelectedGroup(group);
    setParsedRows(parseCuentasSheet(ws, group));
    setDone(false);
  };

  const handleImport = async () => {
    if (!selectedGroup || parsedRows.length === 0) return;
    setImporting(true);
    const items: CuentaPendiente[] = parsedRows.map(row => ({
      id: genId(),
      mes: selectedGroup.monthStr,
      descripcion: row.descripcion,
      tipoPago: row.tipoPago,
      categoria: row.categoria,
      monto: row.monto,
      saldo: row.saldo,
      vencimiento: row.vencimiento,
      estado: row.estado,
      observaciones: '',
    }));
    await importCxPFromExcel(selectedGroup.monthStr, items, conflictMode);
    setImporting(false);
    setDone(true);
  };

  const reset = () => {
    setWorkbook(null);
    setFileName('');
    setMonthGroups([]);
    setSelectedGroup(null);
    setParsedRows([]);
    setDone(false);
    setError('');
  };

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: 'cuentas', label: 'Cuentas → CxP' },
    { id: 'prestamos', label: 'Préstamos → CxP' },
    { id: 'actual', label: 'Actual → Saldos' },
  ];

  return (
    <div className="space-y-6">

      {/* Upload zone */}
      {!workbook ? (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer"
          onClick={() => document.getElementById('excel-input')?.click()}
        >
          <input
            id="excel-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <Upload className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-lg font-bold text-slate-600">Arrastra el Excel aquí o haz clic para elegirlo</p>
          <p className="text-sm text-slate-400 mt-1">Soporta .xlsx y .xls</p>
          {error && (
            <div className="mt-4 flex items-center gap-2 justify-center text-red-600 text-sm font-medium">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <span className="font-bold text-emerald-800 text-sm">{fileName}</span>
            <span className="text-xs text-emerald-600">
              {workbook.SheetNames.length} pestaña{workbook.SheetNames.length !== 1 ? 's' : ''} detectada{workbook.SheetNames.length !== 1 ? 's' : ''}:&nbsp;
              {workbook.SheetNames.join(', ')}
            </span>
          </div>
          <button onClick={reset} className="text-slate-400 hover:text-red-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sheet tabs */}
      {workbook && (
        <div className="flex gap-2 border-b border-slate-200 pb-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 text-sm font-bold rounded-t-xl transition-all border-b-2 ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'text-slate-500 border-transparent hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Cuentas tab ─────────────────────────────────────────────────── */}
      {workbook && activeTab === 'cuentas' && (
        <div className="space-y-5">

          {/* Month selector */}
          {monthGroups.length === 0 ? (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">No se encontraron meses en la pestaña Cuentas.</p>
                <p className="mt-1 text-amber-700">Verifica que la hoja contenga una fila con el nombre del mes (ej: "Mayo 2026") y debajo los encabezados "Deuda", "Vcmto." y "Por pagar".</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Selecciona el mes a importar</p>
              <div className="flex flex-wrap gap-2">
                {monthGroups.map(g => (
                  <button
                    key={g.monthStr}
                    onClick={() => handleSelectMonth(g)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      selectedGroup?.monthStr === g.monthStr
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview table */}
          {parsedRows.length > 0 && selectedGroup && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Vista previa — {parsedRows.length} registros detectados en {selectedGroup.label}
                </p>
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Info className="w-3 h-3" /> Categorías inferidas automáticamente, editables después
                </span>
              </div>

              <div className="overflow-auto max-h-72 rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      {['Descripción', 'Tipo', 'Categoría', 'Deuda', 'Vencimiento', 'Por Pagar', 'Estado'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-bold text-slate-500 border-b border-slate-200 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700 max-w-[200px] truncate">{row.descripcion}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${row.tipoPago === 'TARJETA_CREDITO' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                            {row.tipoPago === 'TARJETA_CREDITO' ? 'TC' : 'EF'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{row.categoria}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(row.monto)}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.vencimiento ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(row.saldo)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                            row.estado === 'PAGADA' ? 'bg-emerald-100 text-emerald-700' :
                            row.estado === 'PARCIAL' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>{row.estado}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Conflict resolution */}
              {existingForMonth.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Ya existen {existingForMonth.length} registros en la webapp para {selectedGroup.label}
                  </div>
                  <div className="space-y-2">
                    {(['replace', 'merge'] as const).map(mode => (
                      <label key={mode} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        conflictMode === mode ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}>
                        <input
                          type="radio"
                          name="conflict"
                          value={mode}
                          checked={conflictMode === mode}
                          onChange={() => setConflictMode(mode)}
                          className="mt-0.5"
                        />
                        <div>
                          <p className="font-bold text-sm text-slate-800">
                            {mode === 'replace' ? 'Reemplazar todo' : 'Combinar (agregar nuevos)'}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {mode === 'replace'
                              ? `Elimina los ${existingForMonth.length} registros actuales e importa los ${parsedRows.length} del Excel.`
                              : 'Importa solo los registros nuevos (por descripción). Los existentes no se modifican.'}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Import button */}
              {done ? (
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-800 font-bold">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  ¡Importación completada! {parsedRows.length} registros de {selectedGroup.label} guardados en Cuentas por Pagar.
                </div>
              ) : (
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {importing ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Importando...</>
                  ) : (
                    <><ChevronRight className="w-4 h-4" /> Importar {parsedRows.length} registros a CxP</>
                  )}
                </button>
              )}
            </div>
          )}

          {parsedRows.length === 0 && selectedGroup && monthGroups.length > 0 && (
            <div className="flex items-center gap-2 text-slate-500 text-sm bg-slate-50 rounded-xl p-4">
              <AlertTriangle className="w-4 h-4" />
              No se encontraron filas válidas para {selectedGroup.label}. Las filas deben tener descripción en columna A y TC/EF en columna B.
            </div>
          )}
        </div>
      )}

      {/* ── Próximamente tabs ────────────────────────────────────────────── */}
      {workbook && (activeTab === 'prestamos' || activeTab === 'actual') && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center">
            <Clock className="w-7 h-7 text-slate-400" />
          </div>
          <div>
            <p className="font-bold text-slate-700 text-lg">Próximamente</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs">
              {activeTab === 'prestamos'
                ? 'Importación de cuotas de préstamos desde la pestaña Préstamos.'
                : 'Importación de saldos diarios desde la pestaña Actual.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
