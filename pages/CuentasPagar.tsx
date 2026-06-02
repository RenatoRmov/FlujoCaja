
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { fmt, ymd, id, shiftToMonday } from '../utils';
import { Badge, KPICard, Modal } from '../components/UI';
import { Plus, Trash2, CheckCircle2, CreditCard, Wallet, Calendar, ChevronDown, Edit2, AlertCircle, RefreshCw, List, DollarSign, X } from 'lucide-react';
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

  // Abonar States
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [payItem, setPayItem] = useState<CuentaPendiente | null>(null);
  const [payFormData, setPayFormData] = useState({
    montoAbono: 0,
    fecha: ymd(new Date()),
    observaciones: '',
    distribuir: false
  });

  // Restructuring States
  const [showRestructure, setShowRestructure] = useState(false);
  const [restructureParams, setRestructureParams] = useState({
    newTotal: 0,
    newCount: 0,
    mode: 'EQUAL' as 'EQUAL' | 'PROPORTIONAL'
  });
  const [previewInstallments, setPreviewInstallments] = useState<CuentaPendiente[]>([]);
  // IDs of orphan items (imported without cuotaActual, duplicates of properly-numbered installments)
  const [orphanIds, setOrphanIds] = useState<string[]>([]);

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

  // Effect to recalculate preview when params change (Restructuring Logic)
  useEffect(() => {
    if (editingItem?.groupId && isEditModalOpen) {
      const { newTotal, newCount, mode } = restructureParams;
      const currentCount = editingInstallments.length;

      let newInsts: CuentaPendiente[] = [];

      // 1. Determine new amounts
      let baseAmounts: number[] = [];

      if (mode === 'EQUAL') {
        const base = Math.floor(newTotal / newCount);
        const remainder = newTotal - (base * newCount);
        baseAmounts = Array(newCount).fill(base);
        baseAmounts[newCount - 1] += remainder;
      } else {
        // PROPORTIONAL (Only if count similar, else fallback to equal for safety)
        if (newCount === currentCount && currentCount > 0) {
          const totalOld = editingInstallments.reduce((sum, i) => sum + i.monto, 0);
          if (totalOld === 0) {
            const base = Math.floor(newTotal / newCount);
            baseAmounts = Array(newCount).fill(base);
            baseAmounts[newCount - 1] += (newTotal - base * newCount);
          } else {
            let allocated = 0;
            baseAmounts = editingInstallments.map((inst, idx) => {
              if (idx === newCount - 1) return 0;
              const share = (inst.monto / totalOld) * newTotal;
              const rounded = Math.floor(share);
              allocated += rounded;
              return rounded;
            });
            baseAmounts[newCount - 1] = newTotal - allocated;
          }
        } else {
          const base = Math.floor(newTotal / newCount);
          const remainder = newTotal - (base * newCount);
          baseAmounts = Array(newCount).fill(base);
          baseAmounts[newCount - 1] += remainder;
        }
      }

      // 2. Map existing paid history
      let mergedPaid: number[] = [];
      // Map current paid amounts to new slots
      if (newCount < currentCount) {
        // Consolidate: first N-1 keep theirs, last one takes the rest
        for (let i = 0; i < newCount - 1; i++) {
          mergedPaid.push(editingInstallments[i].monto - (editingInstallments[i].saldo || 0));
        }
        let tailPaid = 0;
        for (let i = newCount - 1; i < currentCount; i++) {
          tailPaid += (editingInstallments[i].monto - (editingInstallments[i].saldo || 0));
        }
        mergedPaid.push(tailPaid);
      } else {
        // Same or Increase
        for (let i = 0; i < currentCount; i++) {
          mergedPaid.push(editingInstallments[i].monto - (editingInstallments[i].saldo || 0));
        }
        for (let i = currentCount; i < newCount; i++) {
          mergedPaid.push(0);
        }
      }

      // 3. Construct objects
      // Use first installment's date as base or today
      const baseDateStr = editingInstallments.length > 0 ? editingInstallments[0].vencimiento : ymd(new Date());
      const baseDate = dayjs(baseDateStr);

      newInsts = baseAmounts.map((amt, idx) => {
        const oldInst = editingInstallments[idx];
        // Reuse ID if idx exists in old list, else new ID
        const myId = (idx < currentCount) ? oldInst.id : id();

        // Date logic: 
        // If idx exists, use old date. 
        // If new, project monthly from last known.
        let myDate = '';
        if (idx < currentCount) {
          myDate = editingInstallments[idx].vencimiento || '';
        } else {
          const lastKnown = dayjs(editingInstallments[currentCount - 1]?.vencimiento || baseDate);
          myDate = lastKnown.add(idx - currentCount + 1, 'month').format('YYYY-MM-DD');
          myDate = shiftToMonday(myDate);
        }

        const paid = mergedPaid[idx] || 0;
        const balance = Math.max(0, amt - paid);

        return {
          ...editingItem, // Inherit parent props (desc, cat, type)
          id: myId,
          // Start description with Base Name, append (x/y)
          descripcion: editingItem?.descripcion.replace(/\s\(\d+\/\d+\)$/, '') + ` (${idx + 1}/${newCount})`,
          monto: amt,
          saldo: balance,
          vencimiento: myDate,
          estado: balance <= 0 ? 'PAGADA' : (paid > 0 ? 'PARCIAL' : 'PENDIENTE'),
          cuotaActual: idx + 1,
          cuotasTotales: newCount,
          observaciones: (idx < currentCount ? editingInstallments[idx].observaciones : ''),
          groupId: editingItem?.groupId // Ensure group ID persists
        };
      });

      setPreviewInstallments(newInsts);
    }
  }, [restructureParams, editingInstallments, editingItem, isEditModalOpen]);

  const handleDescriptionChange = (val: string) => {
    setFormData(prev => ({ ...prev, descripcion: val }));
    const match = suggested.find(s => s.descripcion.toLowerCase() === val.toLowerCase());
    if (match) {
      setFormData(prev => ({ ...prev, tipoPago: match.tipoPago, categoria: match.categoria }));
    }
  };

  const filteredCxP = useMemo(() => {
    const start = ui.mesConsulta;
    const end = dayjs(ui.mesConsulta).endOf('month').format('YYYY-MM-DD');
    return cxp.filter(item => {
      // Filter by vencimiento range when available; fall back to mes for items without vencimiento
      const inMonth = item.vencimiento
        ? item.vencimiento >= start && item.vencimiento <= end
        : item.mes === ui.mesConsulta;
      const matchesTab = activeTab === 'Todas' || item.categoria === activeTab;
      return inMonth && matchesTab;
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

  const handleSaveRestructure = async () => {
    if (!editingItem || !editingItem.groupId) return;

    const oldIds = editingInstallments.map(i => i.id);
    const newIds = previewInstallments.map(i => i.id);
    // Also delete any orphan items (import duplicates) detected when opening the modal
    const idsToDelete = [
      ...oldIds.filter(oid => !newIds.includes(oid)),
      ...orphanIds,
    ];

    if (idsToDelete.length > 0) {
      await deleteCxP(idsToDelete);
    }
    setOrphanIds([]);

    let newFullList = cxp.filter(item => !idsToDelete.includes(item.id));

    for (const p of previewInstallments) {
      const idx = newFullList.findIndex(x => x.id === p.id);
      if (idx >= 0) {
        newFullList[idx] = p;
      } else {
        newFullList.push(p);
      }
    }

    await setCxP(newFullList);
    setIsEditModalOpen(false);
  };

  const openPayModal = (item: CuentaPendiente) => {
    setPayItem(item);
    setPayFormData({
      montoAbono: item.saldo || item.monto,
      fecha: ymd(new Date()),
      observaciones: '',
      distribuir: !!(item.groupId && (item.cuotasTotales || 0) > 1)
    });
    setIsPayModalOpen(true);
  };

  const handlePay = async () => {
    if (!payItem || payFormData.montoAbono <= 0) return;

    let updatedCxP = [...cxp];

    if (payFormData.distribuir && payItem.groupId) {
      // Distribuir monto entre cuotas del grupo (ordenadas por fecha)
      const groupItems = updatedCxP
        .filter(i => i.groupId === payItem.groupId && i.estado !== 'PAGADA')
        .sort((a, b) => (a.vencimiento || '').localeCompare(b.vencimiento || ''));

      let remaining = payFormData.montoAbono;

      for (const item of groupItems) {
        if (remaining <= 0) break;

        const pending = item.saldo || item.monto;
        const toPay = Math.min(pending, remaining);

        const newSaldo = pending - toPay;
        const newState = newSaldo <= 0 ? 'PAGADA' : 'PARCIAL';

        // Actualizamos en la lista general
        updatedCxP = updatedCxP.map(i => i.id === item.id ? {
          ...i,
          saldo: newSaldo,
          estado: newState,
          observaciones: payFormData.observaciones ? `${i.observaciones ? i.observaciones + ' / ' : ''}Abono: ${fmt(toPay)} (${payFormData.fecha})` : i.observaciones
        } : i);

        remaining -= toPay;
      }
    } else {
      // Abono simple a la cuenta seleccionada
      const currentSaldo = payItem.saldo || payItem.monto;
      const newSaldo = Math.max(0, currentSaldo - payFormData.montoAbono);
      const newState = newSaldo === 0 ? 'PAGADA' : 'PARCIAL';

      updatedCxP = updatedCxP.map(i => i.id === payItem.id ? {
        ...i,
        saldo: newSaldo,
        estado: newState,
        observaciones: payFormData.observaciones ? `${i.observaciones ? i.observaciones + ' / ' : ''}Abono: ${fmt(payFormData.montoAbono)} (${payFormData.fecha})` : i.observaciones
      } : i);
    }

    await setCxP(updatedCxP);
    setIsPayModalOpen(false);
  };

  const addInstallmentToEdit = () => {
    if (!editingItem) return;
    const last = editingInstallments[editingInstallments.length - 1];
    const nextDate = last ? dayjs(last.vencimiento).add(1, 'month').format('YYYY-MM-DD') : ymd(new Date());

    const newInst: CuentaPendiente = {
      ...editingItem,
      id: id(),
      cuotaActual: (last?.cuotaActual || 0) + 1,
      cuotasTotales: (last?.cuotaActual || 0) + 1, // Se ajustará al guardar o recalcular
      vencimiento: nextDate,
      monto: last?.monto || 0,
      saldo: last?.monto || 0,
      estado: 'PENDIENTE',
      observaciones: ''
    };
    setEditingInstallments([...editingInstallments, newInst]);
  };

  const removeInstallmentFromEdit = (idToRemove: string) => {
    setEditingInstallments(prev => prev.filter(i => i.id !== idToRemove));
  };

  const payInstallmentInEdit = (idToPay: string, amount: number) => {
    setEditingInstallments(prev => prev.map(inst => {
      if (inst.id === idToPay) {
        const currentSaldo = inst.saldo || inst.monto;
        const newSaldo = Math.max(0, currentSaldo - amount);
        return {
          ...inst,
          saldo: newSaldo,
          estado: newSaldo === 0 ? 'PAGADA' : 'PARCIAL'
        };
      }
      return inst;
    }));
  };

  const openEdit = (item: CuentaPendiente) => {
    let group: CuentaPendiente[] = [];
    let isGroup = false;

    // 1. Try by groupId
    if (item.groupId) {
      group = cxp.filter(i => i.groupId === item.groupId);
      isGroup = true;
    }
    // 2. Try by pattern matching (Legacy support for "Name (X/Y)")
    else if (/\(\d+\/\d+\)$/.test(item.descripcion)) {
      const baseName = item.descripcion.replace(/\s\(\d+\/\d+\)$/, '').trim();
      // Find potential siblings (must look like "BaseName (X/Y)")
      const siblings = cxp.filter(i => i.descripcion.startsWith(baseName) && /\(\d+\/\d+\)$/.test(i.descripcion));

      // Only treat as group if we found siblings OR the user implies it's a series
      if (siblings.length > 1) {
        group = siblings;
        isGroup = true;

        // Assign a temp groupId to these items so the rest of the logic works
        // The logic in handleSaveRestructure will persist this new groupId
        const tempGroupId = item.groupId || id();
        group = group.map(g => ({ ...g, groupId: tempGroupId }));

        // Update the item being edited to have this groupId too
        item = { ...item, groupId: tempGroupId };
      }
    }

    setEditingItem({ ...item });

    if (isGroup && group.length > 0) {
      // Sort chronologically by vencimiento date; cuotaActual as tiebreaker
      group.sort((a, b) =>
        (a.vencimiento || '').localeCompare(b.vencimiento || '') ||
        (a.cuotaActual || 0) - (b.cuotaActual || 0)
      );

      // Detect orphan items: have groupId but no cuotaActual, and their month already
      // has a properly-numbered installment. These are duplicates from bad Excel imports.
      const monthsWithProperCuota = new Set(
        group.filter(i => (i.cuotaActual ?? 0) > 0).map(i => i.mes)
      );
      const orphans: string[] = [];
      group = group.filter(i => {
        if ((i.cuotaActual ?? 0) === 0 && monthsWithProperCuota.has(i.mes)) {
          orphans.push(i.id);
          return false;
        }
        return true;
      });
      setOrphanIds(orphans);

      setEditingInstallments(group);

      // Init restructuring params
      const totalCurrent = group.reduce((sum, i) => sum + i.monto, 0);
      setRestructureParams({
        newTotal: totalCurrent,
        newCount: group.length,
        mode: 'EQUAL'
      });

      setShowRestructure(true); // Always show restructure for groups
      setPreviewInstallments([]); // Will be populated by effect logic

      setApplyToAll(true);
    } else {
      setEditingInstallments([]);
      setPreviewInstallments([]);
      setApplyToAll(false);
    }
    setIsEditModalOpen(true);
  };

  const markAsPaid = async (itemId: string) => {
    const updated = cxp.map(i => i.id === itemId ? { ...i, estado: 'PAGADA' as const, saldo: 0 } : i);
    await setCxP(updated);
  };

  const handleDelete = useCallback(async (item: CuentaPendiente) => {
    if (item.groupId) {
      const seriesItems = cxp.filter(i => i.groupId === item.groupId);
      if (seriesItems.length > 1) {
        const choice = confirm(`Esta cuenta tiene ${seriesItems.length} cuotas vinculadas en toda la serie.\n\n¿Deseas eliminar TODA la serie de cuotas?`);
        if (choice) {
          await deleteCxP(seriesItems.map(i => i.id));
        } else {
          if (confirm('¿Eliminar únicamente esta cuota específica?')) {
            await deleteCxP(item.id);
          }
        }
        return;
      }
    }
    if (confirm('¿Eliminar este registro permanentemente?')) {
      await deleteCxP(item.id);
    }
  }, [cxp, deleteCxP]);

  const handleDeleteSeries = useCallback(async () => {
    if (!editingItem?.groupId) return;
    const seriesItems = cxp.filter(i => i.groupId === editingItem.groupId);
    const count = seriesItems.length;
    if (!confirm(`¿Eliminar TODA la serie "${editingItem.descripcion.replace(/\s\(\d+\/\d+\)$/, '')}" (${count} cuotas) permanentemente? Esta acción no se puede deshacer.`)) return;
    await deleteCxP(seriesItems.map(i => i.id));
    setIsEditModalOpen(false);
  }, [cxp, editingItem, deleteCxP]);

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
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openPayModal(item); }} className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg" title="Abonar">
                        <DollarSign className="w-4 h-4" />
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
              <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.tipoPago} onChange={e => setFormData({ ...formData, tipoPago: e.target.value as PaymentMethod })}>
                <option value="EFECTIVO">Efectivo / Transferencia</option>
                <option value="TARJETA_CREDITO">Tarjeta de Crédito</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Categoría</label>
              <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.categoria} onChange={e => setFormData({ ...formData, categoria: e.target.value as CategoryType })}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Monto Total</label>
              <input type="number" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-black" value={formData.montoTotal} onChange={e => setFormData({ ...formData, montoTotal: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Primer Vencimiento</label>
              <input type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.vencimientoInicio} onChange={e => setFormData({ ...formData, vencimientoInicio: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Cuotas</label>
              <input type="number" min="1" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={formData.cuotas} onChange={e => setFormData({ ...formData, cuotas: Number(e.target.value) })} />
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
              {editingItem?.groupId && (
                <button type="button" onClick={handleDeleteSeries} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg border border-red-200 flex items-center gap-1.5">
                  <Trash2 className="w-4 h-4" />Eliminar Serie
                </button>
              )}
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">Cancelar</button>
              {applyToAll && editingItem?.groupId ? (
                <button type="button" onClick={handleSaveRestructure} className="bg-blue-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg">Guardar Serie</button>
              ) : (
                <button type="button" onClick={handleSaveEdit} className="bg-blue-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg">Guardar Cambios</button>
              )}
            </div>
          </div>
        }
      >
        {editingItem && (
          <div className="space-y-5">
            {/* Master Edit Form (Always visible for groups) */}
            {applyToAll && editingItem.groupId ? (
              <>
                <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl space-y-4">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-blue-100">
                    <RefreshCw className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-bold text-blue-800 uppercase">Edición Maestra de Serie</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Descripción General</label>
                      <input type="text" className="w-full p-3 bg-white border border-blue-200 rounded-xl outline-none text-sm font-bold focus:ring-2 focus:ring-blue-500"
                        value={editingItem.descripcion.replace(/\s\(\d+\/\d+\)$/, '')}
                        onChange={e => setEditingItem({ ...editingItem, descripcion: e.target.value })} />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Monto Total Deuda</label>
                      <input type="number" className="w-full p-2 bg-white border border-blue-200 rounded-lg text-lg font-black text-blue-900"
                        value={restructureParams.newTotal}
                        onChange={e => setRestructureParams({ ...restructureParams, newTotal: Number(e.target.value) })} />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Total Cuotas</label>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setRestructureParams(p => ({ ...p, newCount: Math.max(1, p.newCount - 1) }))} className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 font-bold">-</button>
                        <input type="number" className="flex-1 p-2 bg-white border border-blue-200 rounded-lg text-lg font-bold text-center"
                          value={restructureParams.newCount}
                          onChange={e => setRestructureParams({ ...restructureParams, newCount: Number(e.target.value) })} />
                        <button type="button" onClick={() => setRestructureParams(p => ({ ...p, newCount: p.newCount + 1 }))} className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 font-bold">+</button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2">Modo de Distribución</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="distMode" className="text-blue-600" checked={restructureParams.mode === 'EQUAL'} onChange={() => setRestructureParams({ ...restructureParams, mode: 'EQUAL' })} />
                        <span className="text-xs font-bold text-slate-600">Partes Iguales</span>
                      </label>
                      {restructureParams.newCount === editingInstallments.length && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="distMode" className="text-blue-600" checked={restructureParams.mode === 'PROPORTIONAL'} onChange={() => setRestructureParams({ ...restructureParams, mode: 'PROPORTIONAL' })} />
                          <span className="text-xs font-bold text-slate-600">Proporcional (Mantiene peso)</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                {/* Preview / Edit List */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <List className="w-3 h-3" /> Desglose Resultante (Vista Previa)
                    </h4>
                    <span className="text-[9px] font-bold text-slate-400 uppercase">{previewInstallments.length} Cuotas</span>
                  </div>

                  <div className="max-h-[320px] overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                    {previewInstallments.map((inst, idx) => (
                      <div key={inst.id} className={`flex gap-2 items-center p-3 rounded-xl border transition-all ${inst.estado === 'PAGADA' ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100 shadow-sm'}`}>
                        <div className="flex flex-col w-12 text-center shrink-0">
                          <span className="text-[10px] font-black text-slate-400 uppercase leading-none">{inst.cuotaActual}/{inst.cuotasTotales}</span>
                          {inst.estado === 'PAGADA' && <span className="text-[8px] font-black text-emerald-600 mt-1 uppercase tracking-tighter">Liquidada</span>}
                        </div>

                        <div className="flex-1 space-y-1">
                          <label className="text-[8px] font-bold text-slate-300 uppercase ml-1 block">Vencimiento</label>
                          <input type="date" className="w-full text-[11px] p-2 bg-slate-50 rounded-lg border-none font-bold outline-none focus:ring-2 focus:ring-blue-400" value={inst.vencimiento || ''} onChange={e => {
                            const newInsts = [...previewInstallments];
                            newInsts[idx] = { ...newInsts[idx], vencimiento: e.target.value };
                            setPreviewInstallments(newInsts);
                          }} />
                        </div>

                        <div className="relative w-28 shrink-0 space-y-1">
                          <label className="text-[8px] font-bold text-slate-300 uppercase ml-1 block">Monto</label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold">$</span>
                            <input type="number" className="w-full text-[11px] p-2 pl-4 bg-slate-50 rounded-lg font-black text-right border-none outline-none focus:ring-2 focus:ring-blue-500" value={inst.monto} onChange={e => {
                              // Allow manual override of amount in preview?
                              // Logic allows it, but it breaks the 'total' sync. 
                              // For now, let's allow it but it might be overwritten if parameters change.
                              const newInsts = [...previewInstallments];
                              const diff = Number(e.target.value) - newInsts[idx].monto;
                              newInsts[idx] = {
                                ...newInsts[idx],
                                monto: Number(e.target.value),
                                saldo: Math.max(0, Number(e.target.value) - (newInsts[idx].monto - newInsts[idx].saldo))
                              };
                              setPreviewInstallments(newInsts);
                              // Optionally update total? 
                              setRestructureParams(prev => ({ ...prev, newTotal: prev.newTotal + diff }));
                            }} />
                          </div>
                        </div>

                        <div className="shrink-0 space-y-1 text-center w-16">
                          <label className="text-[8px] font-bold text-slate-300 uppercase block">Pagado</label>
                          <span className="text-[10px] font-bold text-emerald-600 block pt-2">{fmt(inst.monto - inst.saldo)}</span>
                        </div>

                        <div className="shrink-0 space-y-1 text-center w-16">
                          <label className="text-[8px] font-bold text-slate-300 uppercase block">Saldo</label>
                          <span className="text-[10px] font-black text-slate-700 block pt-2">{fmt(inst.saldo)}</span>
                        </div>

                      </div>
                    ))}
                  </div>

                  <div className="p-2 border-t border-slate-200 flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Total Saldo Pendiente:</span>
                    <span className="text-sm font-black text-slate-800">{fmt(previewInstallments.reduce((sum, i) => sum + i.saldo, 0))}</span>
                  </div>
                </div>
              </>
            ) : (
              // Single Item Edit (Legacy / standard)
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Descripción</label>
                  <input type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.descripcion} onChange={e => setEditingItem({ ...editingItem, descripcion: e.target.value })} />

                  {/* Fallback removed - detection is automatic now */}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Tipo de Pago</label>
                  <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={editingItem.tipoPago} onChange={e => setEditingItem({ ...editingItem, tipoPago: e.target.value as PaymentMethod })}>
                    <option value="EFECTIVO">Efectivo / Transferencia</option>
                    <option value="TARJETA_CREDITO">Tarjeta de Crédito</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Categoría</label>
                  <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={editingItem.categoria} onChange={e => setEditingItem({ ...editingItem, categoria: e.target.value as CategoryType })}>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Vencimiento</label>
                  <input type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-bold" value={editingItem.vencimiento || ''} onChange={e => setEditingItem({ ...editingItem, vencimiento: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Monto</label>
                  <input type="number" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-black" value={editingItem.monto} onChange={e => setEditingItem({ ...editingItem, monto: Number(e.target.value) })} />
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

                      <div className="flex flex-col gap-1 items-center justify-center pl-2 border-l border-slate-100">
                        <button type="button" onClick={() => removeInstallmentFromEdit(inst.id)} className="text-slate-300 hover:text-red-500 transition-colors" title="Eliminar cuota">
                          <X className="w-4 h-4" />
                        </button>
                        {inst.estado !== 'PAGADA' && (
                          <button type="button" onClick={() => payInstallmentInEdit(inst.id, inst.saldo || inst.monto)} className="text-slate-300 hover:text-emerald-500 transition-colors" title="Saldar cuota">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div >
            )}

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Observaciones de la Serie</label>
              <textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500" rows={2} value={editingItem.observaciones} onChange={e => setEditingItem({ ...editingItem, observaciones: e.target.value })} placeholder="Detalles adicionales sobre el préstamo o serie de cuotas..."></textarea>
            </div>
          </div >
        )}
      </Modal >

      <Modal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
        title="Abonar a Cuenta por Pagar"
        footer={
          <div className="flex justify-end gap-2 w-full px-2">
            <button type="button" onClick={() => setIsPayModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button type="button" onClick={handlePay} className="bg-emerald-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-emerald-700 shadow-lg">Registrar Abono</button>
          </div>
        }
      >
        {payItem && (
          <div className="space-y-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-bold text-slate-700">{payItem.descripcion}</h4>
                  <span className="text-xs text-slate-400 font-semibold">{payItem.categoria}</span>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400 font-bold uppercase">Saldo Actual</div>
                  <div className="text-lg font-black text-slate-800">{fmt(payItem.saldo || payItem.monto)}</div>
                </div>
              </div>

              {payItem.groupId && (payItem.cuotasTotales || 0) > 1 && (
                <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-500 flex items-center gap-1">
                    <List className="w-3 h-3" /> Es parte de una serie ({payItem.cuotasTotales} cuotas)
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Monto a Abonar</label>
                <input type="number" className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-lg font-black text-emerald-600 focus:ring-2 focus:ring-emerald-500" value={payFormData.montoAbono} onChange={e => setPayFormData({ ...payFormData, montoAbono: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Fecha Abono</label>
                <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm font-bold" value={payFormData.fecha} onChange={e => setPayFormData({ ...payFormData, fecha: e.target.value })} />
              </div>
            </div>

            {payItem.groupId && (payItem.cuotasTotales || 0) > 1 && (
              <label className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl cursor-pointer">
                <input type="checkbox" className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500" checked={payFormData.distribuir} onChange={e => setPayFormData({ ...payFormData, distribuir: e.target.checked })} />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-blue-900">Distribuir automáticamente</span>
                  <span className="text-[10px] text-blue-500 font-semibold leading-tight">Aplica el abono a las cuotas más antiguas primero hasta agotar el monto.</span>
                </div>
              </label>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Observaciones</label>
              <textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500" rows={2} value={payFormData.observaciones} onChange={e => setPayFormData({ ...payFormData, observaciones: e.target.value })} placeholder="Referencia de transferencia, nro boleta, etc..."></textarea>
            </div>
          </div>
        )}
      </Modal>
    </div >
  );
};

export default CuentasPagar;
