
import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { fmt, ymd, id } from '../utils';
import { Badge, KPICard, Modal } from '../components/UI';
import { Plus, Trash2, CheckCircle2, FileText, Calendar, ChevronDown } from 'lucide-react';
import dayjs from 'dayjs';

const CuentasCobrar: React.FC = () => {
  const { cxc, setCxC, ui, setUI, deleteCxC } = useStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', descripcion: '', monto: 0, vencimiento: '', observaciones: '' });

  const filteredCxC = useMemo(() => {
    return cxc.filter(item => item.mes === ui.mesConsulta);
  }, [cxc, ui.mesConsulta]);

  const kpis = useMemo(() => {
    const total = filteredCxC.reduce((sum, i) => sum + i.monto, 0);
    const pagado = filteredCxC.filter(i => i.estado === 'PAGADA').reduce((sum, i) => sum + i.monto, 0);
    return { total, pagado, pendiente: total - pagado };
  }, [filteredCxC]);

  const handleSave = () => {
    const newItem = {
      id: formData.id || id(),
      mes: ui.mesConsulta,
      descripcion: formData.descripcion,
      monto: formData.monto,
      saldo: formData.monto,
      vencimiento: formData.vencimiento || null,
      estado: 'PENDIENTE' as const,
      observaciones: formData.observaciones
    };

    if (formData.id) {
      setCxC(cxc.map(i => i.id === formData.id ? { ...newItem } : i));
    } else {
      setCxC([...cxc, newItem]);
    }
    setIsModalOpen(false);
  };

  const markAsPaid = (itemId: string) => {
    setCxC(cxc.map(i => i.id === itemId ? { ...i, estado: 'PAGADA', saldo: 0 } : i));
  };

  const handleDelete = async (itemId: string) => {
    if (confirm('¿Deseas eliminar este registro de cobro permanentemente?')) {
      await deleteCxC(itemId);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard title="Total a Cobrar" value={kpis.total} color="white" />
        <KPICard title="Recuperado" value={kpis.pagado} color="green" />
        <KPICard title="Pendiente Cobro" value={kpis.pendiente} color="blue" />
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex justify-between items-center">
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

        <button 
          type="button"
          onClick={() => { setFormData({ id: '', descripcion: '', monto: 0, vencimiento: '', observaciones: '' }); setIsModalOpen(true); }}
          className="bg-blue-600 text-white flex items-center gap-2 px-6 py-2 rounded-lg hover:bg-blue-700 text-sm font-bold shadow-lg shadow-blue-200 transition-all"
        >
          <Plus className="w-4 h-4" /> Nuevo Registro
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
            <tr>
              <th className="px-6 py-4">Deudor / Concepto</th>
              <th className="px-6 py-4">Vencimiento</th>
              <th className="px-6 py-4 text-right">Monto</th>
              <th className="px-6 py-4 text-center">Estado</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredCxC.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">No hay registros este mes</td></tr>
            ) : filteredCxC.map(item => (
              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4 font-bold text-slate-800">{item.descripcion}</td>
                <td className="px-6 py-4 text-slate-500">{item.vencimiento || '-'}</td>
                <td className="px-6 py-4 font-bold text-right">{fmt(item.monto)}</td>
                <td className="px-6 py-4 text-center"><Badge type={item.estado}>{item.estado}</Badge></td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    {item.estado !== 'PAGADA' && (
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); markAsPaid(item.id); }} className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg" title="Marcar como Pagada">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFormData({ ...item as any }); setIsModalOpen(true); }} className="p-2 hover:bg-slate-100 text-slate-400 rounded-lg" title="Detalle"><FileText className="w-4 h-4" /></button>
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(item.id); }} className="p-2 hover:bg-red-50 text-red-600 rounded-lg group" title="Eliminar"><Trash2 className="w-4 h-4 group-active:scale-90 transition-transform" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nueva Cuenta por Cobrar" footer={<button type="button" onClick={handleSave} className="bg-blue-600 text-white px-8 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-100">Guardar</button>}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Descripción / Cliente</label>
            <input type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-blue-500" value={formData.descripcion} onChange={e => setFormData({...formData, descripcion: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Monto</label>
              <input type="number" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold focus:ring-2 focus:ring-blue-500" value={formData.monto} onChange={e => setFormData({...formData, monto: Number(e.target.value)})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Vencimiento</label>
              <input type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-blue-500" value={formData.vencimiento} onChange={e => setFormData({...formData, vencimiento: e.target.value})} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Observaciones</label>
            <textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-blue-500" rows={3} value={formData.observaciones} onChange={e => setFormData({...formData, observaciones: e.target.value})} />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default CuentasCobrar;
