
import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { fmt, ymd, exportToExcel, id } from '../utils';
import { Modal } from '../components/UI';
import { 
  Trash2, 
  FileSpreadsheet, 
  Plus, 
  Landmark, 
  Inbox, 
  Settings2, 
  Edit3, 
  Check, 
  CreditCard,
  Wallet,
  LayoutGrid,
  Table as TableIcon,
  Filter,
  Calendar,
  ChevronDown
} from 'lucide-react';
import dayjs from 'dayjs';
import { Cuenta, AccountType } from '../types';

const SaldoCuentas: React.FC = () => {
  const { saldos, setSaldos, cuentas, setCuentas, ui, setUI, deleteSaldosByDate, deleteCuenta } = useStore();
  
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('grid');
  const [bankFilter, setBankFilter] = useState<string>('TODOS');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDayModalOpen, setIsDeleteDayModalOpen] = useState(false);
  const [isManageAccountsOpen, setIsManageAccountsOpen] = useState(false);
  
  const [selectedBank, setSelectedBank] = useState('');
  const [entryDate, setEntryDate] = useState(ymd(new Date()));
  const [todaySaldos, setTodaySaldos] = useState<Record<string, number>>({});
  const [editingAccount, setEditingAccount] = useState<Cuenta | null>(null);
  const [deleteDate, setDeleteDate] = useState(ymd(new Date()));

  const activeCuentas = useMemo(() => cuentas.filter(c => c.activo), [cuentas]);
  const uniqueBanks = useMemo(() => Array.from(new Set(activeCuentas.map(c => c.banco))), [activeCuentas]);

  const filteredAccounts = useMemo(() => {
    if (bankFilter === 'TODOS') return activeCuentas;
    return activeCuentas.filter(c => c.banco === bankFilter);
  }, [activeCuentas, bankFilter]);

  const accountsByBank = useMemo(() => {
    const groups: Record<string, Cuenta[]> = {};
    filteredAccounts.forEach(c => {
      if (!groups[c.banco]) groups[c.banco] = [];
      groups[c.banco].push(c);
    });
    return groups;
  }, [filteredAccounts]);

  const visibleDates = useMemo(() => {
    const start = dayjs(ui.mesConsulta).startOf('month').format('YYYY-MM-DD');
    const end = dayjs(ui.mesConsulta).endOf('month').format('YYYY-MM-DD');
    const datesWithInfo = Array.from(new Set(
      saldos.filter(s => s.fecha >= start && s.fecha <= end).map(s => s.fecha)
    )) as string[];
    return datesWithInfo.sort((a, b) => b.localeCompare(a));
  }, [saldos, ui.mesConsulta]);

  const getPreviousBalance = (cuentaId: string, date: string): number => {
    const relevantSaldos = saldos
      .filter(s => s.cuentaId === cuentaId && s.fecha < date)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    return relevantSaldos.length > 0 ? relevantSaldos[0].saldo : 0;
  };

  useEffect(() => {
    if (selectedBank && isModalOpen) {
      const bankAccounts = activeCuentas.filter(c => c.banco === selectedBank);
      const initialSaldos: Record<string, number> = {};
      bankAccounts.forEach(acc => {
        const existing = saldos.find(s => s.fecha === entryDate && s.cuentaId === acc.id);
        initialSaldos[acc.id] = existing ? existing.saldo : getPreviousBalance(acc.id, entryDate);
      });
      setTodaySaldos(initialSaldos);
    }
  }, [selectedBank, entryDate, isModalOpen]);

  const handleSaveBankSaldos = () => {
    let newSaldos = [...saldos];
    Object.entries(todaySaldos).forEach(([cuentaId, monto]) => {
      const existingIdx = newSaldos.findIndex(s => s.fecha === entryDate && s.cuentaId === cuentaId);
      if (existingIdx >= 0) newSaldos[existingIdx] = { ...newSaldos[existingIdx], saldo: monto };
      else newSaldos.push({ id: id(), fecha: entryDate, cuentaId, saldo: monto });
    });
    setSaldos(newSaldos);
    setIsModalOpen(false);
  };

  const handleAccountAction = (acc: Partial<Cuenta>) => {
    if (acc.id) setCuentas(cuentas.map(c => c.id === acc.id ? { ...c, ...acc } as Cuenta : c));
    else setCuentas([...cuentas, { ...acc, id: id(), activo: true } as Cuenta]);
    setEditingAccount(null);
  };

  const handleRemoveAccount = async (id: string) => {
    if (confirm('¿Eliminar esta cuenta permanentemente de la base de datos? Se perderá el historial de saldos vinculado.')) {
      await deleteCuenta(id);
    }
  };

  const handleExport = () => {
    const rows = visibleDates.map(date => {
      const row: any = { Fecha: dayjs(date).format('DD/MM/YYYY') };
      activeCuentas.forEach(c => {
        const s = saldos.find(s => s.fecha === date && s.cuentaId === c.id);
        row[`${c.banco} - ${c.nombre} (${c.numeroRef})`] = s ? s.saldo : 0;
      });
      return row;
    });
    const columns = ['Fecha', ...activeCuentas.map(c => `${c.banco} - ${c.nombre} (${c.numeroRef})`)];
    exportToExcel(`Saldos_${dayjs(ui.mesConsulta).format('MMMM_YYYY')}`, rows, columns);
  };

  const kpis = useMemo(() => {
    const lastDayOfMonthStr = dayjs(ui.mesConsulta).endOf('month').format('YYYY-MM-DD');
    const calculateSum = (type: AccountType) => activeCuentas
      .filter(c => c.tipo === type)
      .reduce((sum, c) => {
        const matchingSaldos = saldos.filter(s => s.cuentaId === c.id && s.fecha <= lastDayOfMonthStr);
        if (matchingSaldos.length === 0) return sum;
        return sum + matchingSaldos.sort((a, b) => b.fecha.localeCompare(a.fecha))[0].saldo;
      }, 0);
    return { ccSum: calculateSum('CC'), tcSum: calculateSum('TARJETA') };
  }, [saldos, activeCuentas, ui.mesConsulta]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-2xl shadow-lg shadow-blue-100 text-white flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-[10px] font-bold uppercase tracking-widest mb-1">Cuentas Corrientes (Liquidez)</p>
            <h3 className="text-3xl font-black">{fmt(kpis.ccSum)}</h3>
          </div>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
            <Wallet className="w-6 h-6" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-slate-700 to-slate-900 p-6 rounded-2xl shadow-lg shadow-slate-200 text-white flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Tarjetas de Crédito (Deuda)</p>
            <h3 className="text-3xl font-black">{fmt(kpis.tcSum)}</h3>
          </div>
          <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center backdrop-blur-md">
            <CreditCard className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setViewMode('grid')} className={`px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-bold transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid className="w-4 h-4" /> Cuadrícula</button>
            <button onClick={() => setViewMode('table')} className={`px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-bold transition-all ${viewMode === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><TableIcon className="w-4 h-4" /> Tabla</button>
          </div>
          <div className="h-8 w-[1px] bg-slate-100 mx-2"></div>
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Filter className="w-3 h-3 text-slate-400" />
            <select className="bg-transparent text-xs font-bold text-slate-600 outline-none cursor-pointer" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
              <option value="TODOS">Todos los Bancos</option>
              {uniqueBanks.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          
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
                if (e.target.value) {
                  setUI({ mesConsulta: dayjs(e.target.value).startOf('month').format('YYYY-MM-DD') });
                }
              }} 
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsManageAccountsOpen(true)} className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Gestionar Cuentas"><Settings2 className="w-5 h-5" /></button>
          <div className="h-8 w-[1px] bg-slate-100 mx-1"></div>
          <button onClick={handleExport} className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> Exportar</button>
          <button onClick={() => { setSelectedBank(''); setIsModalOpen(true); }} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all flex items-center gap-2"><Plus className="w-4 h-4" /> Nuevo Saldo</button>
        </div>
      </div>

      {visibleDates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 py-20 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-200"><Inbox className="w-10 h-10" /></div>
          <h4 className="text-slate-800 font-bold">No hay registros este mes</h4>
          <p className="text-slate-400 text-sm mt-1">Empieza registrando los saldos de tus cuentas hoy.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="space-y-8">
          {visibleDates.map(date => (
            <div key={date} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-3 mb-4">
                <div className="px-4 py-1.5 bg-blue-600 text-white rounded-full text-xs font-black shadow-md shadow-blue-100 uppercase tracking-tighter">
                  {dayjs(date).format('dddd, D [de] MMMM')}
                </div>
                <div className="h-[1px] flex-1 bg-slate-100"></div>
                <button onClick={() => { setDeleteDate(date); setIsDeleteDayModalOpen(true); }} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {(Object.entries(accountsByBank) as [string, Cuenta[]][]).map(([bank, items]) => {
                  const bankTotal = items.reduce((sum, c) => {
                    const s = saldos.find(s => s.fecha === date && s.cuentaId === c.id);
                    return sum + (s ? s.saldo : 0);
                  }, 0);
                  return (
                    <div key={bank} onClick={() => { setSelectedBank(bank); setEntryDate(date); setIsModalOpen(true); }} className="bg-white border border-slate-100 p-5 rounded-2xl hover:border-blue-200 hover:shadow-xl hover:shadow-blue-50/40 transition-all cursor-pointer group">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors"><Landmark className="w-4 h-4" /></div>
                          <span className="font-black text-slate-800 uppercase tracking-tighter">{bank}</span>
                        </div>
                        <span className="text-[10px] font-black text-slate-400 group-hover:text-blue-600 transition-colors uppercase">Total Banco</span>
                      </div>
                      <div className="space-y-2 mb-4">
                        {items.map(c => {
                          const s = saldos.find(s => s.fecha === date && s.cuentaId === c.id);
                          return (
                            <div key={c.id} className="flex justify-between items-center py-1 border-b border-slate-50 last:border-0">
                              <span className="text-[11px] font-medium text-slate-500">{c.nombre} {c.numeroRef && `(${c.numeroRef})`}</span>
                              <span className={`text-xs font-bold ${s ? 'text-slate-800' : 'text-slate-200 italic'}`}>{s ? fmt(s.saldo) : 'Sin datos'}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Consolidado</span>
                        <span className={`text-sm font-black ${bankTotal < 0 ? 'text-red-600' : 'text-blue-600'}`}>{fmt(bankTotal)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4 sticky left-0 bg-slate-50 z-20 border-r border-slate-200">Fechas</th>
                  {(Object.entries(accountsByBank) as [string, Cuenta[]][]).map(([bank, items]) => (
                    <th key={bank} colSpan={items.length} className="px-4 py-4 text-center border-r border-slate-200 bg-slate-50">{bank}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleDates.map(date => (
                  <tr key={date} className="hover:bg-blue-50/30 group">
                    <td className="px-6 py-4 font-bold text-slate-500 sticky left-0 bg-white group-hover:bg-blue-50/50 z-20 border-r border-slate-100 text-xs">{dayjs(date).format('DD/MM/YYYY')}</td>
                    {(Object.entries(accountsByBank) as [string, Cuenta[]][]).flatMap(([_, items]) => items.map(c => {
                      const s = saldos.find(s => s.fecha === date && s.cuentaId === c.id);
                      return (<td key={c.id} className="px-3 py-4 text-center border-r border-slate-50 text-xs"><span className={s ? 'text-slate-800 font-bold' : 'text-slate-200'}>{s ? fmt(s.saldo) : '-'}</span></td>);
                    }))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Actualizar Saldo Bancario" footer={(<div className="flex gap-3 justify-end w-full"><button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-slate-500 font-bold bg-slate-100 hover:bg-slate-200 rounded-xl">Cancelar</button><button onClick={handleSaveBankSaldos} disabled={!selectedBank} className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-bold disabled:opacity-50 shadow-lg hover:bg-blue-700 transition-all">Guardar Datos</button></div>)}>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Fecha Contable</label><input type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" value={entryDate} onChange={e => setEntryDate(e.target.value)} /></div>
            <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Entidad Bancaria</label><select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-700 outline-none" value={selectedBank} onChange={e => setSelectedBank(e.target.value)}><option value="">-- Seleccionar --</option>{uniqueBanks.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
          </div>
          {selectedBank && (<div className="space-y-4 pt-2"><h5 className="text-[10px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2"><Edit3 className="w-3 h-3" /> Cuentas Activas - {selectedBank}</h5><div className="grid grid-cols-1 gap-4">{activeCuentas.filter(c => c.banco === selectedBank).map(acc => (<div key={acc.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between"><div><span className="text-xs font-bold text-slate-700 block">{acc.nombre}</span><span className="text-[10px] text-slate-400 uppercase">{acc.numeroRef || 'Sin referencia'}</span></div><div className="relative max-w-[160px]"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span><input type="number" className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-xl outline-none font-black text-slate-800 focus:ring-2 focus:ring-blue-400" value={todaySaldos[acc.id] || 0} onChange={e => setTodaySaldos({...todaySaldos, [acc.id]: Number(e.target.value)})} /></div></div>))}</div></div>)}
        </div>
      </Modal>

      <Modal isOpen={isManageAccountsOpen} onClose={() => setIsManageAccountsOpen(false)} title="Mis Cuentas y Bancos" footer={<button onClick={() => setIsManageAccountsOpen(false)} className="bg-blue-600 text-white px-8 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-100">Cerrar</button>}>
        <div className="space-y-6">
          <button onClick={() => setEditingAccount({ id: '', nombre: '', banco: '', tipo: 'CC', numeroRef: '', activo: true })} className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 hover:text-blue-600 hover:border-blue-200 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"><Plus className="w-4 h-4" /> Agregar Nueva Cuenta</button>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {editingAccount && (
              <div className="p-5 bg-blue-50/50 border border-blue-100 rounded-2xl space-y-4 animate-in zoom-in-95 duration-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-[9px] font-black text-blue-400 uppercase ml-1 mb-1 block">Banco / Entidad</label>
                    <input type="text" className="w-full p-2.5 bg-white border border-blue-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ej: BCI, ITAU, CMR..." value={editingAccount.banco} onChange={e => setEditingAccount({...editingAccount, banco: e.target.value})} />
                  </div>
                  <div className="col-span-1">
                    <label className="text-[9px] font-black text-blue-400 uppercase ml-1 mb-1 block">Tipo Cuenta</label>
                    <select className="w-full p-2.5 bg-white border border-blue-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" value={editingAccount.tipo} onChange={e => setEditingAccount({...editingAccount, tipo: e.target.value as any})}>
                      <option value="CC">Cta. Corriente</option>
                      <option value="TARJETA">Tarjeta Crédito</option>
                      <option value="LC">Línea Crédito</option>
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="text-[9px] font-black text-blue-400 uppercase ml-1 mb-1 block">Referencia (Opcional)</label>
                    <input type="text" className="w-full p-2.5 bg-white border border-blue-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ej: 2853" value={editingAccount.numeroRef} onChange={e => setEditingAccount({...editingAccount, numeroRef: e.target.value})} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[9px] font-black text-blue-400 uppercase ml-1 mb-1 block">Nombre Descriptivo</label>
                    <input type="text" className="w-full p-2.5 bg-white border border-blue-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ej: Cuenta Personal" value={editingAccount.nombre} onChange={e => setEditingAccount({...editingAccount, nombre: e.target.value})} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setEditingAccount(null)} className="px-4 py-2 text-xs font-bold text-slate-400">Cancelar</button>
                  <button onClick={() => handleAccountAction(editingAccount)} className="bg-blue-600 text-white px-6 py-2 rounded-xl text-xs font-bold shadow-md shadow-blue-100">Guardar Cuenta</button>
                </div>
              </div>
            )}
            {cuentas.map(c => (
              <div key={c.id} className={`flex items-center justify-between p-4 bg-white border rounded-2xl group transition-all ${c.activo ? 'border-slate-100 hover:border-blue-200' : 'opacity-50 border-slate-50'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.tipo === 'CC' ? 'bg-emerald-50 text-emerald-600' : c.tipo === 'TARJETA' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
                    {c.tipo === 'CC' ? <Wallet className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
                  </div>
                  <div>
                    <h5 className="text-sm font-black text-slate-800 uppercase tracking-tighter">{c.banco}</h5>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{c.nombre} {c.numeroRef && `- ${c.numeroRef}`}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingAccount(c)} className="p-2 text-slate-300 hover:text-blue-600 transition-colors"><Edit3 className="w-4 h-4" /></button>
                  <button onClick={() => handleAccountAction({ id: c.id, activo: !c.activo })} className={`p-2 transition-colors ${c.activo ? 'text-emerald-500 hover:text-red-400' : 'text-slate-200 hover:text-emerald-500'}`}>{c.activo ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}</button>
                  <button onClick={() => handleRemoveAccount(c.id)} className="p-2 text-slate-300 hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal isOpen={isDeleteDayModalOpen} onClose={() => setIsDeleteDayModalOpen(false)} title="Eliminar Datos" footer={(<div className="flex gap-2 justify-end w-full"><button onClick={() => setIsDeleteDayModalOpen(false)} className="px-5 py-2 text-slate-500 font-bold rounded-xl">Cancelar</button><button onClick={() => { deleteSaldosByDate(deleteDate); setIsDeleteDayModalOpen(false); }} className="bg-red-600 text-white px-8 py-2 rounded-xl font-bold shadow-lg shadow-red-100">Confirmar</button></div>)}><div className="space-y-4"><p className="text-sm text-slate-500">¿Estás seguro de eliminar los saldos de esta fecha?</p><div className="p-4 bg-slate-50 border border-slate-100 rounded-xl font-black text-slate-700 text-center uppercase tracking-widest">{dayjs(deleteDate).format('dddd, D [de] MMMM')}</div></div></Modal>
    </div>
  );
};

export default SaldoCuentas;
