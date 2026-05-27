
import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { fmt, isWeekend, exportToExcel, fmtNumExcel } from '../utils';
import { KPICard, Modal } from '../components/UI';
import { Download, LayoutDashboard, Calendar as CalendarIcon, Info, AlertCircle, Edit3 } from 'lucide-react';
import dayjs from 'dayjs';

const FlujoCaja: React.FC = () => {
  const { saldos, movimientos, cuentas, parametros, setParametros, ingresos, cxp } = useStore();
  const [isEditParamModalOpen, setIsEditParamModalOpen] = useState(false);
  const [tempLineaCredito, setTempLineaCredito] = useState(parametros.lineaCreditoMonto);

  // 1. Calcular la fecha de inicio dinámica (si hay morosidad)
  const startDate = useMemo(() => {
    const today = dayjs().startOf('day');
    const oldestPending = cxp
      .filter(p => p.estado !== 'PAGADA' && p.vencimiento && p.tipoPago === 'EFECTIVO')
      .sort((a, b) => (a.vencimiento || '').localeCompare(b.vencimiento || ''))[0];

    // Si hay deudas vencidas, el flujo comienza en esa fecha para visualizar el impacto
    if (oldestPending && dayjs(oldestPending.vencimiento).isBefore(today)) {
      return dayjs(oldestPending.vencimiento).format('YYYY-MM-DD');
    }
    return today.format('YYYY-MM-DD');
  }, [cxp]);

  // 2. Generar ventana rodante de 60 días
  const projectionDates = useMemo(() => {
    const start = dayjs(startDate);
    return Array.from({ length: 60 }, (_, i) => start.add(i, 'day').format('YYYY-MM-DD'));
  }, [startDate]);

  const ccAccounts = useMemo(() => cuentas.filter(c => c.tipo === 'CC' && c.activo), [cuentas]);
  const lcAccounts = useMemo(() => cuentas.filter(c => c.tipo === 'LC' && c.activo), [cuentas]);

  // 3. Saldo consolidado AL DÍA DE HOY (Saldo_CC_Hoy)
  const saldoCcHoy = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    return ccAccounts.reduce((sum, acc) => {
      const lastS = saldos
        .filter(s => s.cuentaId === acc.id && s.fecha <= today)
        .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
      return sum + (lastS?.saldo || 0);
    }, 0);
  }, [saldos, ccAccounts]);

  // 4. Motor de Proyección Acumulativa
  const dailyProjection = useMemo(() => {
    const todayStr = dayjs().format('YYYY-MM-DD');
    let runningBalance = saldoCcHoy;

    return projectionDates.map(date => {
      const dayMovAbonos = movimientos.filter(m => 
        m.fecha === date && 
        (m.tipo === 'ABONO' || (m.tipo === 'TRANSFERENCIA' && ccAccounts.some(cc => cc.id === m.cuentaHaciaId)))
      );
      const dayIngresos = ingresos.filter(i => i.fecha === date);
      const totalAbonos = dayMovAbonos.reduce((sum, m) => sum + m.monto, 0) + 
                          dayIngresos.reduce((sum, i) => sum + i.monto, 0);

      const dayMovCargos = movimientos.filter(m => 
        m.fecha === date && 
        (m.tipo === 'CARGO' || (m.tipo === 'TRANSFERENCIA' && ccAccounts.some(cc => cc.id === m.cuentaDesdeId)))
      );
      
      const dayCxP = cxp.filter(p => 
        p.vencimiento === date && 
        p.estado !== 'PAGADA' && 
        p.tipoPago === 'EFECTIVO'
      );
      
      const totalCargos = dayMovCargos.reduce((sum, m) => sum + m.monto, 0) +
                          dayCxP.reduce((sum, p) => sum + (p.saldo || p.monto), 0);

      // Calculamos el saldo CC acumulado
      runningBalance = runningBalance + totalAbonos - totalCargos;

      // LÓGICA SOLICITADA: Saldo LC = Cupo Línea + Saldo CC
      const currentLcAvailable = parametros.lineaCreditoMonto + runningBalance;

      const obsList: string[] = [];
      dayIngresos.forEach(i => obsList.push(`(+) ${i.descripcion}`));
      dayCxP.forEach(p => obsList.push(`(-) ${p.descripcion}`));
      dayMovAbonos.forEach(m => obsList.push(`[M] ${m.descripcion}`));
      dayMovCargos.forEach(m => obsList.push(`[M] ${m.descripcion}`));

      return { 
        date, 
        abonos: totalAbonos, 
        cargos: totalCargos, 
        saldoCc: runningBalance, 
        saldoLc: currentLcAvailable, 
        obs: obsList.join('; '),
        isPast: dayjs(date).isBefore(dayjs(), 'day'),
        isToday: date === todayStr
      };
    });
  }, [projectionDates, movimientos, saldos, ccAccounts, lcAccounts, parametros.lineaCreditoMonto, saldoCcHoy, ingresos, cxp]);

  const kpis = useMemo(() => {
    const todayRow = dailyProjection.find(p => p.isToday);
    return { 
      ccActual: saldoCcHoy,
      lineaTotal: parametros.lineaCreditoMonto,
      saldoLc: todayRow?.saldoLc || (parametros.lineaCreditoMonto + saldoCcHoy)
    };
  }, [saldoCcHoy, dailyProjection, parametros.lineaCreditoMonto]);

  const handleExport = () => {
    const columns = ['Fecha', 'Abono', 'Cargo', 'Saldo CC', 'Observaciones', 'Saldo LC'];
    const rows = dailyProjection.map(p => ({
      Fecha: dayjs(p.date).format('dddd, D [de] MMMM [de] YYYY'),
      Abono: p.abonos,
      Cargo: p.cargos,
      'Saldo CC': p.saldoCc,
      Observaciones: p.obs,
      'Saldo LC': p.saldoLc,
      _rawDate: p.date
    }));

    exportToExcel(`Flujo_Caja_Al_${dayjs().format('DD-MM-YYYY')}`, rows, columns, (row) => isWeekend(row._rawDate) ? '#ffff00' : '#ffffff');
  };

  const saveLineaCredito = () => {
    setParametros({ ...parametros, lineaCreditoMonto: tempLineaCredito });
    setIsEditParamModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
            <LayoutDashboard className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">Proyección Financiera (60 Días)</h3>
            <p className="text-xs text-slate-400">
              {dayjs(startDate).isBefore(dayjs(), 'day') 
                ? `Iniciando desde el ${dayjs(startDate).format('D [de] MMMM')} por morosidad`
                : `Proyectando flujos futuros desde hoy`}
            </p>
          </div>
        </div>
        <button 
          onClick={handleExport}
          className="bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 shadow-lg transition-all text-sm"
        >
          <Download className="w-4 h-4" /> Exportar Planilla
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard title="SALDO CC HOY (CONSOLIDADO)" value={kpis.ccActual} color="white" />
        <div className="relative group">
          <KPICard title="CUPO LÍNEA CRÉDITO" value={kpis.lineaTotal} color="white" />
          <button onClick={() => { setTempLineaCredito(parametros.lineaCreditoMonto); setIsEditParamModalOpen(true); }} className="absolute top-4 right-4 p-2 bg-slate-50 text-slate-400 rounded-lg hover:text-blue-600 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100"><Edit3 className="w-4 h-4" /></button>
        </div>
        <KPICard title="DISPONIBLE LÍNEA (ESTIMADO)" value={kpis.saldoLc} color="green" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 bg-slate-50/30 flex items-center gap-2">
           <CalendarIcon className="w-5 h-5 text-slate-400" />
           <h4 className="font-bold text-slate-700">Flujos Proyectados y Saldo Actual</h4>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-white text-slate-400 uppercase text-[10px] font-bold tracking-wider">
              <tr className="border-b border-slate-100">
                <th className="px-6 py-4 w-[320px]">Día y Fecha</th>
                <th className="px-6 py-4 text-center">Abonos (+)</th>
                <th className="px-6 py-4 text-center">Cargos (-)</th>
                <th className="px-6 py-4 text-center">SALDO CC</th>
                <th className="px-6 py-4">Observaciones</th>
                <th className="px-6 py-4 text-center">SALDO LC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dailyProjection.map(row => {
                const weekend = isWeekend(row.date);
                const isToday = row.isToday;
                
                return (
                  <tr 
                    key={row.date} 
                    className={`transition-colors border-l-4 ${
                      isToday ? 'border-l-blue-600 bg-blue-50/40' : 
                      row.isPast ? 'border-l-amber-400 bg-amber-50/20' : 
                      weekend ? 'border-l-amber-200 bg-yellow-50' : 'border-l-transparent bg-white'
                    } hover:bg-slate-50`}
                  >
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className={`text-sm font-bold capitalize ${weekend ? 'text-amber-800' : 'text-slate-700'}`}>
                          {dayjs(row.date).format('dddd, D [de] MMMM [de] YYYY')}
                        </span>
                        {isToday && <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-0.5">Hoy</span>}
                      </div>
                    </td>
                    <td className={`px-6 py-4 text-center font-bold ${row.abonos > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {row.abonos > 0 ? fmt(row.abonos) : '-'}
                    </td>
                    <td className={`px-6 py-4 text-center font-bold ${row.cargos > 0 ? 'text-rose-500' : 'text-slate-300'}`}>
                      {row.cargos > 0 ? fmt(row.cargos) : '-'}
                    </td>
                    <td className={`px-6 py-4 text-center font-black ${row.saldoCc < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                      <span className="text-base">{fmt(row.saldoCc)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-[10px] text-slate-500 max-w-xs leading-relaxed italic">
                        {row.obs || <span className="text-slate-200">Sin movimientos proyectados</span>}
                      </div>
                    </td>
                    <td className={`px-6 py-4 text-center font-black ${row.saldoLc < 0 ? 'text-rose-600' : 'text-blue-600'}`}>
                      {fmt(row.saldoLc)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isEditParamModalOpen} onClose={() => setIsEditParamModalOpen(false)} title="Configuración de Parámetros" footer={(<div className="flex gap-2 justify-end w-full"><button onClick={() => setIsEditParamModalOpen(false)} className="px-5 py-2 text-slate-500 font-bold rounded-xl hover:bg-slate-100">Cancelar</button><button onClick={saveLineaCredito} className="bg-blue-600 text-white px-8 py-2 rounded-xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700">Guardar</button></div>)}>
        <div className="space-y-4">
          <label className="block text-xs font-bold text-slate-400 uppercase mb-2 ml-1">Cupo Total Línea de Crédito (CLP)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">$</span>
            <input type="number" className="w-full p-4 pl-8 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 text-lg focus:ring-2 focus:ring-blue-500" value={tempLineaCredito} onChange={e => setTempLineaCredito(Number(e.target.value))} />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default FlujoCaja;
