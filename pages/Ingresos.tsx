
import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { fmt, ymd, id } from '../utils';
import { KPICard, Modal } from '../components/UI';
import { Plus, Calendar, Trash2, Edit2, ChevronDown } from 'lucide-react';
import dayjs from 'dayjs';

const Ingresos: React.FC = () => {
  const { ingresos, setIngresos, ui, setUI, deleteIngreso } = useStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', fecha: ymd(new Date()), monto: 0, descripcion: '' });

  const filteredIngresos = useMemo(() => {
    const start = dayjs(ui.mesConsulta).startOf('month');
    const end = dayjs(ui.mesConsulta).endOf('month');
    return ingresos.filter(i => {
      const d = dayjs(i.fecha);
      return d.isAfter(start.subtract(1, 'ms')) && d.isBefore(end.add(1, 'ms'));
    }).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [ingresos, ui.mesConsulta]);

  const kpis = useMemo(() => {
    const total = filteredIngresos.reduce((sum, i) => sum + i.monto, 0);
    const count = filteredIngresos.length;
    const distinctDays = new Set(filteredIngresos.map(i => i.fecha)).size;
    const avg = distinctDays > 0 ? total / distinctDays : 0;
    return { total, count, avg };
  }, [filteredIngresos]);

  const handleSave = () => {
    if (formData.id) {
      setIngresos(ingresos.map(i => i.id === formData.id ? { ...formData } : i));
    } else {
      setIngresos([...ingresos, { ...formData, id: id() }]);
    }
    setIsModalOpen(false);
  };

  const handleDelete = async (itemId: string) => {
    if (confirm('¿Eliminar este registro de ingreso permanentemente?')) {
      await deleteIngreso(itemId);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard title="Total Ingresos" value={kpis.total} />
        <KPICard title="Registros" value={kpis.count} color="white" isCurrency={false} />
        <KPICard title="Promedio Diario" value={kpis.avg} color="green" />
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
          onClick={() => { setFormData({ id: '', fecha: ymd(new Date()), monto: 0, descripcion: '' }); setIsModalOpen(true); }}
          className="bg-emerald-600 text-white flex items-center gap-2 px-6 py-2.5 rounded-xl hover:bg-emerald-700 text-sm font-bold shadow-lg shadow-emerald-100 transition-all"
        >
          <Plus className="w-4 h-4" /> Nuevo Ingreso
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
            <tr>
              <th className="px-6 py-4 text-center">Fecha</th>
              <th className="px-6 py-4">Descripción</th>
              <th className="px-6 py-4">Monto</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredIngresos.length === 0 ? (
              <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">No hay ingresos proyectados para este mes</td></tr>
            ) : filteredIngresos.map(i => (
              <tr key={i.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4 text-center font-bold text-slate-500">
                  {dayjs(i.fecha).format('DD')} <span className="text-[10px] uppercase font-normal text-slate-400 ml-1">{dayjs(i.fecha).format('MMM')}</span>
                </td>
                <td className="px-6 py-4 font-medium text-slate-800">{i.descripcion}</td>
                <td className="px-6 py-4 font-bold text-emerald-600">{fmt(i.monto)}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFormData({ ...i }); setIsModalOpen(true); }} className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg" title="Editar"><Edit2 className="w-4 h-4" /></button>
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(i.id); }} className="p-2 hover:bg-red-50 text-red-600 rounded-lg group" title="Eliminar"><Trash2 className="w-4 h-4 group-active:scale-90 transition-transform" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nuevo Ingreso Proyectado" footer={<button type="button" onClick={handleSave} className="bg-emerald-600 text-white px-8 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-100">Guardar</button>}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Fecha Proyectada</label>
            <input type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-blue-500" value={formData.fecha} onChange={e => setFormData({...formData, fecha: e.target.value})} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Monto</label>
            <input type="number" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold focus:ring-2 focus:ring-blue-500" value={formData.monto} onChange={e => setFormData({...formData, monto: Number(e.target.value)})} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Descripción</label>
            <input type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-blue-500" value={formData.descripcion} onChange={e => setFormData({...formData, descripcion: e.target.value})} />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Ingresos;
