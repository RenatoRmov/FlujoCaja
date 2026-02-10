
import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { fmt, ymd, id } from '../utils';
import { Badge, KPICard, Modal } from '../components/UI';
import { Plus, Search, Trash2, Edit2, Upload, AlertCircle, Calendar, ChevronDown } from 'lucide-react';
import dayjs from 'dayjs';

const Transferencias: React.FC = () => {
  const { movimientos, setMovimientos, cuentas, ui, setUI, importMovimientos, clearMonthMovimientos, deleteMovimiento } = useStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [editMov, setEditMov] = useState({ 
    id: '', 
    fecha: ymd(new Date()), 
    tipo: 'TRANSFERENCIA' as const, 
    monto: 0, 
    descripcion: '', 
    cuentaDesdeId: '', 
    cuentaHaciaId: '', 
    observaciones: '' 
  });

  const filteredMovs = useMemo(() => {
    const start = dayjs(ui.mesConsulta).startOf('month');
    const end = dayjs(ui.mesConsulta).endOf('month');
    return movimientos.filter(m => {
      const d = dayjs(m.fecha);
      const inMonth = d.isAfter(start.subtract(1, 'ms')) && d.isBefore(end.add(1, 'ms'));
      const matchesSearch = m.descripcion.toLowerCase().includes(ui.filtros.texto.toLowerCase()) || 
                            m.observaciones.toLowerCase().includes(ui.filtros.texto.toLowerCase());
      const matchesType = ui.filtros.tipoMov === 'TODOS' || m.tipo === ui.filtros.tipoMov;
      return inMonth && matchesSearch && matchesType;
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [movimientos, ui.mesConsulta, ui.filtros]);

  const totalTransferido = useMemo(() => 
    filteredMovs.filter(m => m.tipo === 'TRANSFERENCIA').reduce((sum, m) => sum + m.monto, 0)
  , [filteredMovs]);

  const handleSave = () => {
    if (editMov.id) {
      setMovimientos(movimientos.map(m => m.id === editMov.id ? { ...editMov as any } : m));
    } else {
      setMovimientos([...movimientos, { ...editMov as any, id: id() }]);
    }
    setIsModalOpen(false);
  };

  const handleRemove = async (mid: string) => {
    if (confirm('¿Eliminar este movimiento permanentemente?')) {
      await deleteMovimiento(mid);
    }
  };

  const handleClearMonth = () => {
    if (confirm('¿Desea eliminar todos los movimientos registrados de este mes?')) {
      clearMonthMovimientos(ui.mesConsulta);
    }
  };

  const handleBulkImport = () => {
    try {
      const lines = bulkText.trim().split('\n');
      const imported: any[] = [];
      
      lines.forEach((line, index) => {
        if (index === 0 && line.toLowerCase().includes('fecha')) return;
        const [fecha, tipo, monto, descripcion, desde, hacia, obs] = line.split(',').map(s => s?.trim());
        if (!fecha || !tipo || !monto) return;
        const findAccount = (search: string) => {
          if (!search) return null;
          return cuentas.find(c => c.nombre.toLowerCase() === search.toLowerCase() || c.numeroRef === search)?.id || null;
        };
        imported.push({
          id: id(),
          fecha: ymd(dayjs(fecha)),
          tipo: tipo as any,
          monto: Number(monto),
          descripcion: descripcion || '',
          cuentaDesdeId: findAccount(desde),
          cuentaHaciaId: findAccount(hacia),
          observaciones: obs || ''
        });
      });

      if (imported.length > 0) {
        importMovimientos(imported);
        setIsBulkModalOpen(false);
        setBulkText('');
        alert(`${imported.length} movimientos importados con éxito.`);
      }
    } catch (err) {
      alert('Error al procesar el CSV. Verifique el formato.');
    }
  };

  return (
    <div className="space-y-6">
      <KPICard title="Total Transferido (Mes)" value={totalTransferido} color="blue" />

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Buscar por descripción..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            value={ui.filtros.texto}
            onChange={e => setUI({ filtros: { ...ui.filtros, texto: e.target.value } })}
          />
        </div>
        <select 
          className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          value={ui.filtros.tipoMov}
          onChange={e => setUI({ filtros: { ...ui.filtros, tipoMov: e.target.value } })}
        >
          <option value="TODOS">Todos los tipos</option>
          <option value="ABONO">Abonos</option>
          <option value="CARGO">Cargos</option>
          <option value="TRANSFERENCIA">Transferencias</option>
        </select>

        <div className="relative flex items-center gap-3 px-4 py-2 bg-white border-2 border-slate-100 rounded-xl hover:border-blue-400 hover:bg-slate-50 transition-all shadow-sm group cursor-pointer">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase leading-none mb-0.5">Periodo</span>
            <span className="text-sm font-bold text-slate-700 capitalize leading-none">
              {dayjs(ui.mesConsulta).format('MMMM YYYY')}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors ml-1" />
          <input 
            type="month" 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" 
            value={dayjs(ui.mesConsulta).format('YYYY-MM')} 
            onChange={(e) => { 
              if (e.target.value) setUI({ mesConsulta: dayjs(e.target.value).startOf('month').format('YYYY-MM-DD') }); 
            }} 
          />
        </div>

        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={handleClearMonth} className="text-red-600 px-4 py-2 border border-red-100 rounded-lg text-sm font-medium hover:bg-red-50">
            Borrar Mes
          </button>
          <button type="button" onClick={() => setIsBulkModalOpen(true)} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">
            <Upload className="w-4 h-4" /> Masivo
          </button>
          <button 
            type="button"
            onClick={() => {
              setEditMov({ id: '', fecha: ymd(new Date()), tipo: 'TRANSFERENCIA', monto: 0, descripcion: '', cuentaDesdeId: '', cuentaHaciaId: '', observaciones: '' });
              setIsModalOpen(true);
            }} 
            className="bg-blue-600 text-white flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
          >
            <Plus className="w-4 h-4" /> Nueva
          </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
            <tr>
              <th className="px-6 py-4">Fecha</th>
              <th className="px-6 py-4">Detalle</th>
              <th className="px-6 py-4">Desde / Hacia</th>
              <th className="px-6 py-4">Monto</th>
              <th className="px-6 py-4">Tipo</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredMovs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">No hay movimientos en este periodo</td>
              </tr>
            ) : filteredMovs.map(m => (
              <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-500">{dayjs(m.fecha).format('DD/MM/YY')}</td>
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-900">{m.descripcion}</div>
                  <div className="text-xs text-slate-400">{m.observaciones}</div>
                </td>
                <td className="px-6 py-4 text-xs font-medium text-slate-600">
                  {m.tipo !== 'ABONO' && (
                    <div className="mb-1"><span className="text-[8px] uppercase text-slate-400 block">De:</span> {cuentas.find(c => c.id === m.cuentaDesdeId)?.nombre || 'Externo'}</div>
                  )}
                  {m.tipo !== 'CARGO' && (
                    <div><span className="text-[8px] uppercase text-slate-400 block">A:</span> {cuentas.find(c => c.id === m.cuentaHaciaId)?.nombre || 'Externo'}</div>
                  )}
                </td>
                <td className="px-6 py-4 font-bold text-slate-800">{fmt(m.monto)}</td>
                <td className="px-6 py-4"><Badge type={m.tipo}>{m.tipo}</Badge></td>
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditMov({ ...m as any }); setIsModalOpen(true); }} className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemove(m.id); }} className="p-2 hover:bg-red-50 text-red-600 rounded-lg group transition-colors"><Trash2 className="w-4 h-4 group-active:scale-90 transition-transform" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={editMov.id ? "Editar Movimiento" : "Nueva Transferencia/Movimiento"}
        footer={(
          <>
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-500 font-medium transition-colors hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button type="button" onClick={handleSave} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold shadow-md hover:bg-blue-700 transition-all">Guardar</button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {(['ABONO', 'CARGO', 'TRANSFERENCIA'] as const).map(t => (
              <button 
                key={t}
                type="button"
                onClick={() => setEditMov({...editMov, tipo: t})}
                className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${editMov.tipo === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Fecha</label>
              <input type="date" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold" value={editMov.fecha} onChange={e => setEditMov({...editMov, fecha: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Monto</label>
              <input type="number" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-black" value={editMov.monto} onChange={e => setEditMov({...editMov, monto: Number(e.target.value)})} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Descripción</label>
            <input type="text" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold" value={editMov.descripcion} onChange={e => setEditMov({...editMov, descripcion: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {editMov.tipo !== 'ABONO' && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cuenta Origen</label>
                <select className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold" value={editMov.cuentaDesdeId || ''} onChange={e => setEditMov({...editMov, cuentaDesdeId: e.target.value})}>
                  <option value="">Seleccione...</option>
                  {cuentas.filter(c => c.activo).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            )}
            {editMov.tipo !== 'CARGO' && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cuenta Destino</label>
                <select className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold" value={editMov.cuentaHaciaId || ''} onChange={e => setEditMov({...editMov, cuentaHaciaId: e.target.value})}>
                  <option value="">Seleccione...</option>
                  {cuentas.filter(c => c.activo).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Observaciones</label>
            <textarea className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium" rows={2} value={editMov.observaciones} onChange={e => setEditMov({...editMov, observaciones: e.target.value})}></textarea>
          </div>
        </div>
      </Modal>

      <Modal 
        isOpen={isBulkModalOpen} 
        onClose={() => setIsBulkModalOpen(false)} 
        title="Carga Masiva de Movimientos"
        footer={(
          <>
            <button type="button" onClick={() => setIsBulkModalOpen(false)} className="px-4 py-2 text-slate-500 font-medium transition-colors hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button type="button" onClick={handleBulkImport} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold shadow-md hover:bg-blue-700 transition-all">Importar Datos</button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Formato CSV (sin cabecera):</p>
              <p className="font-mono mt-1">fecha, tipo, monto, descripcion, cuenta_desde, cuenta_hacia, observaciones</p>
              <p className="mt-1 opacity-80">Las cuentas se resuelven por nombre o número de referencia.</p>
            </div>
          </div>
          <textarea 
            className="w-full h-48 p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="2023-10-01, ABONO, 50000, Pago Cliente, , CC ITAU, Varios"
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
          ></textarea>
        </div>
      </Modal>
    </div>
  );
};

export default Transferencias;
