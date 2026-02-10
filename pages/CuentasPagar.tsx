
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { fmt, ymd, id, shiftToMonday } from '../utils';
import { Badge, KPICard, Modal } from '../components/UI';
import { Plus, Trash2, CheckCircle2, CreditCard, Wallet, Calendar, ChevronDown, Edit2, AlertCircle, RefreshCw, List } from 'lucide-react';
import dayjs from 'dayjs';
import { PaymentMethod, CategoryType, CuentaPendiente, AccountStatus } from '../types';

const CuentasPagar: React.FC = () => {
  const { cxp, setCxP, ui, setUI, suggested, saveSuggestion, deleteCxP } = useStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Todas');
  const [applyToAll, setApplyToAll] = useState(true);
  
  const [formData, setFormData] = useState({
    id: '',
    descripcion: '',
    tipoPago: 'EFECTIVO' as PaymentMethod,
    categoria: 'Gastos Casa' as CategoryType,
    montoTotal: 0,
    vencimientoInicio: ymd(new Date()),
    cuotas: 1,
    observaciones: ''
  });

  const [editingItem, setEditingItem] = useState<CuentaPendiente | null>(null);
  const [editingInstallments, setEditingInstallments] = useState<CuentaPendiente[]>([]);
  const [installments, setInstallments] = useState<any[]>([]);

  const categories: CategoryType[] = ['Gastos Casa', 'Tarjeta de credito', 'Seguros', 'Tag', 'Prestamos', 'Gastos Operacionales', 'Otros'];

  useEffect(() => {
    if (formData.cuotas > 0 && !isEditModalOpen && isModalOpen) {
      const baseMonto = Math.floor(formData.montoTotal / formData.cuotas);
      const newInstallments = Array.from({ length: formData.cuotas }, (_, i) => {
        let date = dayjs(formData.vencimientoInicio).add(i, 'month').format('YYYY-MM-DD');
        date = shiftToMonday(date);
        return {
          id: id(),
          monto: baseMonto,
          vencimiento: date,
          cuota: i + 1
        };
      });
      setInstallments(newInstallments);
    }
  }, [formData.cuotas, formData.montoTotal, formData.vencimientoInicio, isEditModalOpen, isModalOpen]);

  const handleDescriptionChange = (val: string) => {
    setFormData(prev => ({ ...prev, descripcion: val }));
    const match = suggested.find(s => s.descripcion.toLowerCase() === val.toLowerCase());
    if (match) {
      setFormData(prev => ({ ...prev, tipoPago: match.tipoPago, categoria: match.categoria }));
    }
  };

  const filteredCxP = useMemo(() => {
    return cxp.filter(item => {
      const isMonth = item.mes === ui.mesConsulta;
      const matchesTab = activeTab === 'Todas' || item.categoria === activeTab;
      return isMonth && matchesTab;
    }).sort((a, b) => (a.vencimiento || '').localeCompare(b.vencimiento || ''));
  }, [cxp, ui.mesConsulta, activeTab]);

  const kpis = useMemo(() => {
    const total = filteredCxP.reduce((sum, i) => sum + i.monto, 0);
    const pagado = filteredCxP.filter(i => i.estado === 'PAGADA').reduce((sum, i) => sum + i.monto, 0);
    return { total, pagado, pendiente: total - pagado };
  }, [filteredCxP]);

  const handleSaveNew = async () => {
    saveSuggestion({
      descripcion: formData.descripcion,
      tipoPago: formData.tipoPago,
      categoria: formData.categoria
    });

    const commonGroupId = id(); 

    const newEntries = installments.map(inst => ({
      id: inst.id,
      mes: dayjs(inst.vencimiento).startOf('month').format('YYYY-MM-DD'),
      descripcion: `${formData.descripcion}${formData.cuotas > 1 ? ` (${inst.cuota}/${formData.cuotas})` : ''}`,
      monto: inst.monto,
      saldo: inst.monto,
      vencimiento: inst.vencimiento,
      estado: 'PENDIENTE' as const,
      observaciones: formData.observaciones,
      tipoPago: formData.tipoPago,
      categoria: formData.categoria,
      cuotaActual: inst.cuota,
      cuotasTotales: formData.cuotas,
      groupId: commonGroupId
    }));

    await setCxP([...cxp, ...newEntries]);
    setIsModalOpen(false);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    
    if (applyToAll && editingItem.groupId) {
      const baseName = editingItem.descripcion.replace(/\s\(\d+\/\d+\)$/, '');
      
      // Mapeamos todos los items para actualizar la serie completa
      const updatedCxP = cxp.map(item => {
        // Si el item pertenece al mismo grupo, lo actualizamos
        if (item.groupId === editingItem.groupId) {
          // Buscamos si este item específico del grupo fue modificado en la lista del modal
          const modified = editingInstallments.find(ei => ei.id === item.id);
          const currentItem = modified || item;
          
          return {
            ...currentItem,
            descripcion: currentItem.cuotasTotales && currentItem.cuotasTotales > 1 
              ? `${baseName} (${currentItem.cuotaActual}/${currentItem.cuotasTotales})` 
              : baseName,
            categoria: editingItem.categoria,
            tipoPago: editingItem.tipoPago,
            observaciones: editingItem.observaciones,
            mes: dayjs(currentItem.vencimiento).startOf('month').format('YYYY-MM-DD'),
            saldo: currentItem.estado === 'PAGADA' ? 0 : currentItem.monto
          };
        }
        return item;
      });
      
      await setCxP(updatedCxP);
    } else {
      // Edición individual
      const updatedItem = {
        ...editingItem,
        mes: dayjs(editingItem.vencimiento).startOf('month').format('YYYY-MM-DD'),
        saldo: editingItem.estado === 'PAGADA' ? 0 : editingItem.monto
      };
      await setCxP(cxp.map(i => i.id === updatedItem.id ? updatedItem : i));
    }
    setIsEditModalOpen(false);
  };

  const openEdit = (item: CuentaPendiente) => {
    setEditingItem({ ...item });
    if (item.groupId) {
      // Cargamos TODA la serie vinculada
      const group = cxp
        .filter(i => i.groupId === item.groupId)
        .sort((a, b) => (a.cuotaActual || 0) - (b.cuotaActual || 0));
      setEditingInstallments(group);
      setApplyToAll(true);
    } else {
      setEditingInstallments([]);
      setApplyToAll(false);
    }
    setIsEditModalOpen(true);
  };

  const markAsPaid = async (itemId: string) => {
    const updated = cxp.map(i => i.id === itemId ? { ...i, estado: 'PAGADA' as const, saldo: 0 } : i);
    await setCxP(updated);
  };

  const handleDelete = useCallback(async (item: CuentaPendiente) => {
    if (item.groupId && (item.cuotasTotales || 0) > 1) {
      const choice = confirm(`Esta cuenta tiene ${item.cuotasTotales} cuotas vinculadas.\n\n¿Deseas eliminar TODA la serie de cuotas?`);
      if (choice) {
        const idsToRemove = cxp.filter(i => i.groupId === item.groupId).map(i => i.id);
        await deleteCxP(idsToRemove);
      } else {
        const individual = confirm('¿Deseas eliminar únicamente esta cuota específica?');
        if (individual) {
          await deleteCxP(item.id);
        }
      }
    } else {
      if (confirm('¿Eliminar este registro permanentemente?')) {
        await deleteCxP(item.id);
      }
    }
  }, [cxp, deleteCxP]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard title="Total Mes" value={kpis.total} color="white" />
        <KPICard title="Pagado" value={kpis.pagado} color="green" />
        <KPICard title="Pendiente" value={kpis.pendiente} color="red" />
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide border-b border-slate-100 mb-4">
          <button type="button" onClick={() => setActiveTab('Todas')} className={`px-4 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-colors ${activeTab === 'Todas' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>Todas</button>
          {categories.map(tab => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-colors ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{tab}</button>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 items-center justify-between">
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
            onClick={() => {
              setFormData({ id: '', descripcion: '', tipoPago: 'EFECTIVO', categoria: 'Gastos Casa', montoTotal: 0, vencimientoInicio: ymd(new Date()), cuotas: 1, observaciones: '' });
              setIsModalOpen(true);
            }}
            className="bg-blue-600 text-white flex items-center gap-2 px-6 py-2 rounded-lg hover:bg-blue-700 text-sm font-bold shadow-lg shadow-blue-200 transition-all"
          >
            <Plus className="w-5 h-5" /> Nueva Cuenta
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
            <tr>
              <th className="px-6 py-4">Descripción / Cat.</th>
              <th className="px-6 py-4 text-center">Tipo Pago</th>
              <th className="px-6 py-4 text-center">Vencimiento</th>
              <th className="px-6 py-4 text-right">Monto</th>
              <th className="px-6 py-4 text-center">Estado</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredCxP.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">No hay cuentas por pagar este mes</td></tr>
            ) : filteredCxP.map(item => (
              <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-800">{item.descripcion}</div>
                  <div className="text-[10px] text-blue-500 uppercase font-bold">{item.categoria}</div>
                </td>
                <td className="px-6 py-4 text-center">
                  {item.tipoPago === 'EFECTIVO' ? <Wallet className="w-4 h-4 text-slate-400 mx-auto" /> : <CreditCard className="w-4 h-4 text-purple-400 mx-auto" />}
                </td>
                <td className="px-6 py-4 text-center text-slate-500 font-medium">
                  {item.vencimiento ? dayjs(item.vencimiento).format('DD/MM/YYYY') : '-'}
                </td>
                <td className="px-6 py-4 text-right font-bold text-slate-900">{fmt(item.monto)}</td>
                <td className="px-6 py-4 text-center"><Badge type={item.estado}>{item.estado}</Badge></td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    {item.estado !== 'PAGADA' && (
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); markAsPaid(item.id); }} className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg" title="Marcar como Pagada">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEdit(item); }} className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg" title="Editar">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      type="button"
                      onClick={(e) => { 
                        e.preventDefault(); 
                        e.stopPropagation(); 
                        handleDelete(item); 
                      }} 
                      className="p-2 hover:bg-red-50 text-red-600 rounded-lg group transition-all" 
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4 group-active:scale-90 transition-transform pointer-events-none" />
                    </button>
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
        title="Ingresar Cuenta por Pagar" 
        footer={
          <div className="flex justify-between items-center w-full px-2">
            <div className="text-left">
              <span className="text-xs text-slate-400 block uppercase font-bold tracking-tighter">Monto Total</span>
              <span className="text-lg font-bold text-slate-900">{fmt(formData.montoTotal)}</span>
            </div>
            <button type="button" onClick={handleSaveNew} className="bg-blue-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg">Registrar</button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Descripción / Proveedor</label>
              <input type="text" list="descriptions" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-blue-500" value={formData.descripcion} onChange={e => handleDescriptionChange(e.target.value)} />
              <datalist id="descriptions">{suggested.map(s => <option key={s.descripcion} value={s.descripcion} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Tipo de Pago</label>
              <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.tipoPago} onChange={e => setFormData({...formData, tipoPago: e.target.value as PaymentMethod})}>
                <option value="EFECTIVO">Efectivo / Transferencia</option>
                <option value="TARJETA_CREDITO">Tarjeta de Crédito</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Categoría</label>
              <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.categoria} onChange={e => setFormData({...formData, categoria: e.target.value as CategoryType})}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Monto Total</label>
              <input type="number" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-black" value={formData.montoTotal} onChange={e => setFormData({...formData, montoTotal: Number(e.target.value)})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Primer Vencimiento</label>
              <input type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.vencimientoInicio} onChange={e => setFormData({...formData, vencimientoInicio: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Cuotas</label>
              <input type="number" min="1" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.cuotas} onChange={e => setFormData({...formData, cuotas: Number(e.target.value)})} />
            </div>
          </div>

          {formData.cuotas > 0 && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 pb-2">Desglose proyectado</h4>
              <div className="max-h-48 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                {installments.map((inst, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
                    <span className="text-[9px] font-bold text-slate-400 w-8">{inst.cuota}/{formData.cuotas}</span>
                    <input type="date" className="flex-1 text-[11px] p-2 bg-slate-50 rounded border-none font-bold" value={inst.vencimiento} onChange={e => { const news = [...installments]; news[idx].vencimiento = e.target.value; setInstallments(news); }} />
                    <input type="number" className="w-24 text-[11px] p-2 bg-slate-50 rounded font-black text-right border-none" value={inst.monto} onChange={e => { const news = [...installments]; news[idx].monto = Number(e.target.value); setInstallments(news); }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        title={applyToAll ? "Editar Serie de Cuotas" : "Editar Cuenta Individual"}
        footer={
          <div className="flex justify-between items-center w-full px-2">
            <div className="text-left">
              <span className="text-xs text-slate-400 block uppercase font-bold tracking-tighter">Total Selección</span>
              <span className="text-lg font-bold text-slate-900">
                {fmt(applyToAll ? editingInstallments.reduce((sum, i) => sum + i.monto, 0) : editingItem?.monto || 0)}
              </span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button type="button" onClick={handleSaveEdit} className="bg-blue-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg">Guardar Cambios</button>
            </div>
          </div>
        }
      >
        {editingItem && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Descripción Base</label>
                <input type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.descripcion.replace(/\s\(\d+\/\d+\)$/, '')} onChange={e => setEditingItem({...editingItem, descripcion: e.target.value})} />
              </div>

              {editingItem.groupId && (
                <div className="col-span-2 p-3 bg-blue-50 rounded-xl flex items-center justify-between border border-blue-100 shadow-sm shadow-blue-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-blue-600 shadow-sm border border-blue-100">
                      <RefreshCw className={`w-5 h-5 ${applyToAll ? 'animate-spin-slow' : ''}`} />
                    </div>
                    <div className="flex flex-col">
                       <span className="text-[11px] font-black text-blue-700 uppercase leading-none mb-1">Modo de Edición Masiva</span>
                       <span className="text-[9px] text-blue-400 font-bold uppercase tracking-tight">Sincroniza datos en toda la serie</span>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={applyToAll} onChange={() => setApplyToAll(!applyToAll)} />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Tipo de Pago</label>
                <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={editingItem.tipoPago} onChange={e => setEditingItem({...editingItem, tipoPago: e.target.value as PaymentMethod})}>
                  <option value="EFECTIVO">Efectivo / Transferencia</option>
                  <option value="TARJETA_CREDITO">Tarjeta de Crédito</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Categoría</label>
                <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={editingItem.categoria} onChange={e => setEditingItem({...editingItem, categoria: e.target.value as CategoryType})}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {!applyToAll && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Vencimiento</label>
                    <input type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={editingItem.vencimiento || ''} onChange={e => setEditingItem({...editingItem, vencimiento: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Monto Individual</label>
                    <input type="number" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-black" value={editingItem.monto} onChange={e => setEditingItem({...editingItem, monto: Number(e.target.value)})} />
                  </div>
                </>
              )}
            </div>

            {applyToAll && editingInstallments.length > 0 && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <List className="w-3 h-3" /> Desglose de la Serie Completa
                  </h4>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">{editingInstallments.length} Cuotas registradas</span>
                </div>
                
                <div className="max-h-[320px] overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                  {editingInstallments.map((inst, idx) => (
                    <div key={inst.id} className={`flex gap-2 items-center p-3 rounded-xl border transition-all ${inst.estado === 'PAGADA' ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100 shadow-sm hover:border-blue-200'}`}>
                      <div className="flex flex-col w-12 text-center shrink-0">
                        <span className="text-[10px] font-black text-slate-400 uppercase leading-none">{inst.cuotaActual}/{inst.cuotasTotales}</span>
                        {inst.estado === 'PAGADA' && <span className="text-[8px] font-black text-emerald-600 mt-1 uppercase tracking-tighter">Liquidada</span>}
                        {inst.id === editingItem.id && <span className="text-[7px] font-black text-blue-600 mt-1 uppercase">Actual</span>}
                      </div>
                      
                      <div className="flex-1 space-y-1">
                        <label className="text-[8px] font-bold text-slate-300 uppercase ml-1 block">Vencimiento</label>
                        <input type="date" className="w-full text-[11px] p-2 bg-slate-50 rounded-lg border-none font-bold outline-none focus:ring-2 focus:ring-blue-400" value={inst.vencimiento || ''} onChange={e => {
                            const newInsts = [...editingInstallments];
                            newInsts[idx] = { ...newInsts[idx], vencimiento: e.target.value };
                            setEditingInstallments(newInsts);
                          }} />
                      </div>

                      <div className="relative w-28 shrink-0 space-y-1">
                        <label className="text-[8px] font-bold text-slate-300 uppercase ml-1 block">Monto</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold">$</span>
                          <input type="number" className="w-full text-[11px] p-2 pl-4 bg-slate-50 rounded-lg font-black text-right border-none outline-none focus:ring-2 focus:ring-blue-500" value={inst.monto} onChange={e => {
                              const newInsts = [...editingInstallments];
                              newInsts[idx] = { ...newInsts[idx], monto: Number(e.target.value) };
                              setEditingInstallments(newInsts);
                            }} />
                        </div>
                      </div>

                      <div className="shrink-0 space-y-1">
                         <label className="text-[8px] font-bold text-slate-300 uppercase ml-1 block text-center">Estado</label>
                         <select className={`text-[10px] p-2 bg-slate-50 rounded-lg border-none font-black outline-none shrink-0 cursor-pointer ${inst.estado === 'PAGADA' ? 'text-emerald-600' : 'text-slate-600'}`} value={inst.estado} onChange={e => {
                            const newInsts = [...editingInstallments];
                            newInsts[idx] = { ...newInsts[idx], estado: e.target.value as AccountStatus };
                            setEditingInstallments(newInsts);
                          }}>
                          <option value="PENDIENTE">PEND</option>
                          <option value="PAGADA">PAG</option>
                          <option value="PARCIAL">PARC</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Observaciones de la Serie</label>
              <textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500" rows={2} value={editingItem.observaciones} onChange={e => setEditingItem({...editingItem, observaciones: e.target.value})} placeholder="Detalles adicionales sobre el préstamo o serie de cuotas..."></textarea>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CuentasPagar;
