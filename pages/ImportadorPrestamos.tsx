
import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { fmt, id as genId } from '../utils';
import { analyzePrestamos, buildPrestamosPlan, parsePrestamosSheet } from '../importHelpers';
import type { PrestamoAnalysis, PrestamoEstado } from '../importHelpers';

const BADGE: Record<PrestamoEstado, { text: string; cls: string; title: string }> = {
  NUEVO: { text: '+ NUEVO', cls: 'bg-emerald-100 text-emerald-700', title: 'No existe en el sistema' },
  COMPLETAR: { text: '↻ COMPLETAR', cls: 'bg-sky-100 text-sky-700', title: 'Solo tiene una cuota suelta en el sistema; se agrega el resto' },
  EXISTE: { text: '↔ EXISTE', cls: 'bg-blue-100 text-blue-700', title: 'Ya está cargado en el sistema' },
};

const dmy = (iso: string) => dayjs(iso).format('DD/MM/YYYY');

export default function ImportadorPrestamos({ workbook }: { workbook: XLSX.WorkBook }) {
  const { cxp, importPrestamosFromExcel } = useStore();

  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ cuotas: number; prestamos: number; eliminadas: number } | null>(null);

  const sheetName = workbook.SheetNames.find(n =>
    n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes('prestamo')
  );

  const blocks = useMemo(
    () => (sheetName ? parsePrestamosSheet(workbook.Sheets[sheetName], dayjs().format('YYYY-MM-DD')) : []),
    [workbook, sheetName]
  );
  const analyses = useMemo(() => analyzePrestamos(blocks, cxp), [blocks, cxp]);

  // En "Combinar" los préstamos que ya existen no se tocan; en "Reemplazar" todos se pueden elegir
  const isSelected = (a: PrestamoAnalysis) => {
    if (mode === 'merge' && a.estado === 'EXISTE') return false;
    return overrides[a.block.key] ?? true;
  };
  const selected = useMemo(
    () => new Set(analyses.filter(a => !(mode === 'merge' && a.estado === 'EXISTE') && (overrides[a.block.key] ?? true)).map(a => a.block.key)),
    [analyses, overrides, mode]
  );
  const plan = useMemo(() => buildPrestamosPlan(analyses, selected, mode, genId), [analyses, selected, mode]);

  const count = (e: PrestamoEstado) => analyses.filter(a => a.estado === e).length;
  const hayExistentes = analyses.some(a => a.estado !== 'NUEVO');

  const toggle = (a: PrestamoAnalysis) => {
    setDone(null);
    setOverrides(prev => ({ ...prev, [a.block.key]: !isSelected(a) }));
  };

  const handleImport = async () => {
    if (plan.insert.length === 0) return;
    if (mode === 'replace' && plan.deleteIds.length > 0) {
      const parcial = plan.parciales > 0 ? `\n(${plan.parciales} tienen abonos parciales registrados que se perderán.)` : '';
      if (!confirm(`Se eliminarán ${plan.deleteIds.length} cuotas no pagadas del sistema y se importarán ${plan.insert.length} del Excel.${parcial}\n\nLas cuotas ya pagadas se conservan. ¿Continuar?`)) return;
    }
    setImporting(true);
    const fresh = buildPrestamosPlan(analyses, selected, mode, genId);
    const ok = await importPrestamosFromExcel(fresh);
    setImporting(false);
    if (ok) setDone({ cuotas: fresh.insert.length, prestamos: fresh.prestamos, eliminadas: fresh.deleteIds.length });
  };

  if (!sheetName) {
    return (
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">No se encontró la pestaña "Prestamos" en el archivo.</p>
          <p className="mt-1">Pestañas disponibles: {workbook.SheetNames.join(', ')}.</p>
        </div>
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">No se encontraron préstamos con cuotas pendientes en la pestaña "{sheetName}".</p>
          <p className="mt-1">Cada préstamo debe tener su nombre en la fila 1 y, debajo, el número de cuota, el monto y la fecha en tres columnas contiguas.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Vista previa — {analyses.length} préstamos con cuotas pendientes en «{sheetName}»
        </p>
        <span className="text-xs flex items-center gap-3 font-bold">
          <span className="text-emerald-600">{count('NUEVO')} nuevos</span>
          {count('COMPLETAR') > 0 && <span className="text-sky-600">{count('COMPLETAR')} por completar</span>}
          <span className="text-blue-600">{count('EXISTE')} ya existen</span>
        </span>
      </div>

      <div className="overflow-auto max-h-[28rem] rounded-xl border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              {['', '', 'Préstamo', 'Cuotas', 'Vencimientos', '1ª cuota', 'Total pendiente', 'En el sistema', ''].map((h, i) => (
                <th key={i} className="text-left px-3 py-2 font-bold text-slate-500 border-b border-slate-200 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analyses.map(a => {
              const b = a.block;
              const open = !!expanded[b.key];
              const on = isSelected(a);
              const locked = mode === 'merge' && a.estado === 'EXISTE';
              const totalPend = b.cuotas.reduce((s, q) => s + q.monto, 0);
              return (
                <React.Fragment key={b.key}>
                  <tr className={`border-b border-slate-100 hover:bg-slate-50 ${locked ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(a)} className="w-4 h-4 rounded" />
                    </td>
                    <td className="px-3 py-2">
                      <span title={BADGE[a.estado].title} className={`px-1.5 py-0.5 rounded font-bold text-[9px] whitespace-nowrap ${BADGE[a.estado].cls}`}>{BADGE[a.estado].text}</span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-700 max-w-[240px]">
                      <div className="truncate">{b.nombre}</div>
                      <div className="text-slate-400 text-[9px] truncate">Excel: {b.label} · col. {b.key}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{b.cuotas.length} <span className="text-slate-400">de {b.total}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{dmy(b.cuotas[0].vencimiento)} → {dmy(b.cuotas[b.cuotas.length - 1].vencimiento)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(b.cuotas[0].monto)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">{fmt(totalPend)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {a.existing.length === 0 ? '—' : (
                        <>
                          {a.existingPendientes.length} pend. · {a.paidCount} pag.
                          {a.diff && (a.diff.difieren > 0 || a.diff.faltan > 0 || a.diff.sobran > 0) && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded font-bold text-[9px] bg-amber-100 text-amber-700" title={`${a.diff.iguales} iguales · ${a.diff.difieren} con monto o fecha distinta · ${a.diff.faltan} faltan en el sistema · ${a.diff.sobran} sobran en el sistema`}>
                              {a.diff.difieren + a.diff.faltan + a.diff.sobran} difieren
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setExpanded(prev => ({ ...prev, [b.key]: !open }))} className="flex items-center gap-1 text-slate-400 hover:text-blue-600 font-bold" title="Ver detalle">
                        {b.avisos.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50/70 border-b border-slate-100">
                      <td colSpan={9} className="px-6 py-3 space-y-3">
                        {b.avisos.length > 0 && (
                          <ul className="space-y-1 text-[11px] text-amber-800">
                            {b.avisos.map((t, i) => <li key={i} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t}</li>)}
                          </ul>
                        )}
                        {a.diff && (
                          <p className="text-[11px] text-slate-500">
                            Comparado con el sistema: <b>{a.diff.iguales}</b> cuotas iguales · <b>{a.diff.difieren}</b> con monto o fecha distinta · <b>{a.diff.faltan}</b> faltan en el sistema · <b>{a.diff.sobran}</b> sobran en el sistema.
                          </p>
                        )}
                        <div className="max-h-52 overflow-auto rounded-lg border border-slate-200 bg-white">
                          <table className="w-full text-[11px]">
                            <thead className="bg-slate-50 sticky top-0">
                              <tr>{['N°', 'Vencimiento', 'Monto', 'Nota'].map(h => <th key={h} className="text-left px-3 py-1.5 font-bold text-slate-500 border-b border-slate-200">{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {b.cuotas.map(q => (
                                <tr key={q.fila} className="border-b border-slate-50">
                                  <td className="px-3 py-1 text-slate-500">{q.n}/{b.total}</td>
                                  <td className="px-3 py-1 text-slate-600">{dmy(q.vencimiento)}</td>
                                  <td className="px-3 py-1 font-mono text-slate-700">{fmt(q.monto)}</td>
                                  <td className="px-3 py-1 text-amber-700">{q.flag ?? ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {hayExistentes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
            <AlertTriangle className="w-4 h-4" />{count('EXISTE') + count('COMPLETAR')} de estos préstamos ya están (total o parcialmente) en el sistema
          </div>
          <div className="space-y-2">
            {(['merge', 'replace'] as const).map(m => (
              <label key={m} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${mode === m ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <input type="radio" name="prestamos-conflict" value={m} checked={mode === m} onChange={() => { setDone(null); setMode(m); }} className="mt-0.5" />
                <div>
                  <p className="font-bold text-sm text-slate-800">{m === 'replace' ? 'Reemplazar' : 'Combinar (agregar nuevos)'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {m === 'replace'
                      ? 'Para los préstamos marcados, elimina sus cuotas no pagadas del sistema e importa las del Excel (así quedan iguales). Las cuotas ya pagadas se conservan y la numeración continúa después de ellas.'
                      : 'Agrega los préstamos nuevos con todas sus cuotas pendientes. Los que ya existen en el sistema no se modifican.'}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {done ? (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-800 font-bold">
          <CheckCircle className="w-5 h-5 text-emerald-600" />
          ¡Importación completada! {done.cuotas} cuotas de {done.prestamos} {done.prestamos === 1 ? 'préstamo' : 'préstamos'}
          {done.eliminadas > 0 && <span className="font-medium"> · {done.eliminadas} cuotas anteriores reemplazadas</span>}
        </div>
      ) : (
        <button
          onClick={handleImport}
          disabled={importing || plan.insert.length === 0}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {importing
            ? <><RefreshCw className="w-4 h-4 animate-spin" />Importando...</>
            : plan.insert.length === 0
              ? <>Nada que importar con la selección actual</>
              : <><ChevronRight className="w-4 h-4" />
                  Importar {plan.insert.length} cuotas de {plan.prestamos} {plan.prestamos === 1 ? 'préstamo' : 'préstamos'}
                  {mode === 'replace' && plan.deleteIds.length > 0 && ` (reemplaza ${plan.deleteIds.length})`}
                </>}
        </button>
      )}
    </div>
  );
}
