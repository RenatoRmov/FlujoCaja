
import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Cuenta, SaldoDiario, Movimiento, CuentaPendiente,
  IngresoRecibir, Parametros, UIState, SuggestedDescription
} from './types';
import { id, ymd } from './utils';
import { supabase } from './supabase';
import dayjs from 'dayjs';

interface GlobalStore {
  cuentas: Cuenta[];
  saldos: SaldoDiario[];
  movimientos: Movimiento[];
  cxp: CuentaPendiente[];
  cxc: CuentaPendiente[];
  ingresos: IngresoRecibir[];
  parametros: Parametros;
  ui: UIState;
  suggested: SuggestedDescription[];

  setCuentas: (v: Cuenta[]) => void;
  setSaldos: (v: SaldoDiario[]) => void;
  setMovimientos: (v: Movimiento[]) => void;
  setCxP: (v: CuentaPendiente[]) => void;
  setCxC: (v: CuentaPendiente[]) => void;
  setIngresos: (v: IngresoRecibir[]) => void;
  setParametros: (v: Parametros) => void;
  setUI: (v: Partial<UIState>) => void;
  saveSuggestion: (s: SuggestedDescription) => void;

  loadDemoData: () => void;
  deleteSaldosByDate: (fecha: string) => void;
  clearMonthSaldos: (month: string) => void;
  importMovimientos: (rows: Movimiento[]) => void;
  clearMonthMovimientos: (month: string) => void;

  importCxPFromExcel: (month: string, items: CuentaPendiente[], mode: 'replace' | 'merge') => Promise<void>;
  importSaldosFromExcel: (items: SaldoDiario[], mode: 'replace' | 'merge') => Promise<void>;

  // Funciones de eliminación física
  deleteCxP: (idOrIds: string | string[]) => Promise<void>;
  deleteCxC: (idOrIds: string | string[]) => Promise<void>;
  deleteIngreso: (id: string) => Promise<void>;
  deleteMovimiento: (id: string) => Promise<void>;
  deleteCuenta: (id: string) => Promise<void>;
}

const GlobalStoreContext = createContext<GlobalStore | undefined>(undefined);

export const GlobalStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cuentas, setCuentasState] = useState<Cuenta[]>([]);
  const [saldos, setSaldosState] = useState<SaldoDiario[]>([]);
  const [movimientos, setMovimientosState] = useState<Movimiento[]>([]);
  const [cxp, setCxPState] = useState<CuentaPendiente[]>([]);
  const [cxc, setCxCState] = useState<CuentaPendiente[]>([]);
  const [ingresos, setIngresosState] = useState<IngresoRecibir[]>([]);
  const [parametros, setParametrosState] = useState<Parametros>({ lineaCreditoMonto: 18720000 });
  const [suggested, setSuggestedState] = useState<SuggestedDescription[]>([]);

  const [ui, setUIState] = useState<UIState>({
    mesConsulta: dayjs().startOf('month').format('YYYY-MM-DD'),
    filtros: { texto: '', tipoMov: 'TODOS' },
    loading: true
  });

  const setUI = (patch: Partial<UIState>) => setUIState(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    const fetchData = async () => {
      setUI({ loading: true });
      try {
        const [
          { data: dCuentas },
          { data: dSaldos },
          { data: dMovs },
          { data: dCxP },
          { data: dCxC },
          { data: dIngresos },
          { data: dParams },
          { data: dSuggest }
        ] = await Promise.all([
          supabase.from('cuentas').select('*'),
          supabase.from('saldos').select('*'),
          supabase.from('movimientos').select('*'),
          supabase.from('cxp').select('*'),
          supabase.from('cxc').select('*'),
          supabase.from('ingresos').select('*'),
          supabase.from('parametros').select('*'),
          supabase.from('suggested_descriptions').select('*')
        ]);

        if (dCuentas) setCuentasState(dCuentas);
        if (dSaldos) setSaldosState(dSaldos);
        if (dMovs) setMovimientosState(dMovs);
        if (dCxP) setCxPState(dCxP);
        if (dCxC) setCxCState(dCxC);
        if (dIngresos) setIngresosState(dIngresos);
        if (dParams?.[0]) setParametrosState(dParams[0]);
        if (dSuggest) setSuggestedState(dSuggest);
      } catch (err) {
        console.error("Error cargando datos de Supabase:", err);
      } finally {
        setUI({ loading: false });
      }
    };

    fetchData();
  }, []);

  /* 
     CRITICAL: Added Error Handling for Persistence 
     We verify the result of every upsert to ensure data reaches Supabase.
  */

  const handleSupabaseError = (operation: string, error: any) => {
    console.error(`Error in ${operation}:`, error);
    alert(`Error crítico guardando en base de datos (${operation}): ${error.message || JSON.stringify(error)}`);
  };

  const setCuentas = async (v: Cuenta[]) => {
    setCuentasState(v);
    const { error } = await supabase.from('cuentas').upsert(v);
    if (error) handleSupabaseError('setCuentas', error);
  };

  const setSaldos = async (v: SaldoDiario[]) => {
    setSaldosState(v);
    const { error } = await supabase.from('saldos').upsert(v);
    if (error) handleSupabaseError('setSaldos', error);
  };

  const setMovimientos = async (v: Movimiento[]) => {
    setMovimientosState(v);
    const { error } = await supabase.from('movimientos').upsert(v);
    if (error) handleSupabaseError('setMovimientos', error);
  };

  const setCxP = async (v: CuentaPendiente[]) => {
    setCxPState(v);
    // Optimization: If list is huge, we might want to upsert only changes. 
    // But for now, ensuring persistence is paramount.
    const { error } = await supabase.from('cxp').upsert(v);
    if (error) handleSupabaseError('setCxP', error);
  };

  const setCxC = async (v: CuentaPendiente[]) => {
    setCxCState(v);
    const { error } = await supabase.from('cxc').upsert(v);
    if (error) handleSupabaseError('setCxC', error);
  };

  const setIngresos = async (v: IngresoRecibir[]) => {
    setIngresosState(v);
    const { error } = await supabase.from('ingresos').upsert(v);
    if (error) handleSupabaseError('setIngresos', error);
  };

  const setParametros = async (v: Parametros) => {
    setParametrosState(v);
    const { error } = await supabase.from('parametros').upsert({ id: 'global', ...v });
    if (error) handleSupabaseError('setParametros', error);
  };

  const saveSuggestion = async (s: SuggestedDescription) => {
    const newSuggest = [s, ...suggested.filter(p => p.descripcion !== s.descripcion)].slice(0, 50);
    setSuggestedState(newSuggest);
    const { error } = await supabase.from('suggested_descriptions').upsert(s);
    if (error) handleSupabaseError('saveSuggestion', error);
  };

  const deleteSaldosByDate = async (fecha: string) => {
    const { error } = await supabase.from('saldos').delete().eq('fecha', fecha);
    if (error) {
      console.error('Error al eliminar saldos:', error);
      alert('Error en base de datos: ' + error.message);
    } else {
      setSaldosState(prev => prev.filter(s => s.fecha !== fecha));
    }
  };

  const clearMonthSaldos = async (monthDate: string) => {
    const start = dayjs(monthDate).startOf('month').format('YYYY-MM-DD');
    const end = dayjs(monthDate).endOf('month').format('YYYY-MM-DD');
    const { error } = await supabase.from('saldos').delete().gte('fecha', start).lte('fecha', end);
    if (error) {
      console.error('Error al limpiar mes de saldos:', error);
    } else {
      setSaldosState(prev => prev.filter(s => s.fecha < start || s.fecha > end));
    }
  };

  const importMovimientos = async (newMovs: Movimiento[]) => {
    const { error } = await supabase.from('movimientos').insert(newMovs);
    if (!error) {
      setMovimientosState(prev => [...prev, ...newMovs]);
    }
  };

  const clearMonthMovimientos = async (monthDate: string) => {
    const start = dayjs(monthDate).startOf('month').format('YYYY-MM-DD');
    const end = dayjs(monthDate).endOf('month').format('YYYY-MM-DD');
    const { error } = await supabase.from('movimientos').delete().gte('fecha', start).lte('fecha', end);
    if (error) {
      console.error('Error al limpiar mes de movimientos:', error);
    } else {
      setMovimientosState(prev => prev.filter(m => m.fecha < start || m.fecha > end));
    }
  };

  const importSaldosFromExcel = async (items: SaldoDiario[], mode: 'replace' | 'merge') => {
    if (mode === 'replace') {
      // Delete the entire month range for each month present in the import
      // This cleans up stale future dates from previous imports
      const months = [...new Set(items.map(i => i.fecha.substring(0, 7)))];
      for (const month of months) {
        const start = `${month}-01`;
        const end = dayjs(start).endOf('month').format('YYYY-MM-DD');
        await supabase.from('saldos').delete().gte('fecha', start).lte('fecha', end);
      }
      const freshState = saldos.filter(s => !months.includes(s.fecha.substring(0, 7)));
      const { error } = await supabase.from('saldos').insert(items);
      if (error) { handleSupabaseError('importSaldosFromExcel', error); return; }
      setSaldosState([...freshState, ...items]);
    } else {
      const existingKeys = new Set(saldos.map(s => `${s.fecha}_${s.cuentaId}`));
      const newItems = items.filter(i => !existingKeys.has(`${i.fecha}_${i.cuentaId}`));
      if (newItems.length === 0) return;
      const { error } = await supabase.from('saldos').insert(newItems);
      if (error) { handleSupabaseError('importSaldosFromExcel:merge', error); return; }
      setSaldosState(prev => [...prev, ...newItems]);
    }
  };

  const importCxPFromExcel = async (month: string, items: CuentaPendiente[], mode: 'replace' | 'merge') => {
    if (mode === 'replace') {
      // Delete only this month — future installments of credits remain intact
      const { error: delError } = await supabase.from('cxp').delete().eq('mes', month);
      if (delError) { handleSupabaseError('importCxPFromExcel:delete', delError); return; }
      // Insert only the incoming items; other months are already correct in the DB
      const { error } = await supabase.from('cxp').insert(items);
      if (error) { handleSupabaseError('importCxPFromExcel:insert', error); return; }
      setCxPState([...cxp.filter(i => i.mes !== month), ...items]);
    } else {
      const existingInMonth = cxp.filter(i => i.mes === month);
      const existingDescs = new Set(existingInMonth.map(i => i.descripcion));
      // If a groupId already has a member in this month, don't add another one
      const existingGroupIds = new Set(existingInMonth.filter(i => i.groupId).map(i => i.groupId!));

      // Deduplicate within incoming batch too (same groupId or same description = same credit)
      const seenKeys = new Set<string>();
      const newItems = items.filter(i => {
        const key = i.groupId ?? i.descripcion;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        if (existingDescs.has(i.descripcion)) return false;
        if (i.groupId && existingGroupIds.has(i.groupId)) return false;
        return true;
      });
      if (newItems.length === 0) return;
      const { error } = await supabase.from('cxp').insert(newItems);
      if (error) { handleSupabaseError('importCxPFromExcel:merge', error); return; }
      setCxPState([...cxp, ...newItems]);
    }
  };

  const deleteCxP = async (idOrIds: string | string[]) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const { error } = await supabase.from('cxp').delete().in('id', ids);
    if (error) {
      console.error('Error eliminando de cxp:', error);
      alert('Error al eliminar en base de datos: ' + error.message);
    } else {
      setCxPState(prev => prev.filter(i => !ids.includes(i.id)));
    }
  };

  const deleteCxC = async (idOrIds: string | string[]) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const { error } = await supabase.from('cxc').delete().in('id', ids);
    if (error) {
      console.error('Error eliminando de cxc:', error);
      alert('Error al eliminar en base de datos: ' + error.message);
    } else {
      setCxCState(prev => prev.filter(i => !ids.includes(i.id)));
    }
  };

  const deleteIngreso = async (id: string) => {
    const { error } = await supabase.from('ingresos').delete().eq('id', id);
    if (error) {
      console.error('Error eliminando ingreso:', error);
      alert('Error al eliminar en base de datos: ' + error.message);
    } else {
      setIngresosState(prev => prev.filter(i => i.id !== id));
    }
  };

  const deleteMovimiento = async (id: string) => {
    const { error } = await supabase.from('movimientos').delete().eq('id', id);
    if (error) {
      console.error('Error eliminando movimiento:', error);
      alert('Error al eliminar en base de datos: ' + error.message);
    } else {
      setMovimientosState(prev => prev.filter(m => m.id !== id));
    }
  };

  const deleteCuenta = async (id: string) => {
    const { error } = await supabase.from('cuentas').delete().eq('id', id);
    if (error) {
      console.error('Error eliminando cuenta:', error);
      alert('Error al eliminar en base de datos: ' + error.message);
    } else {
      setCuentasState(prev => prev.filter(c => c.id !== id));
    }
  };

  const loadDemoData = async () => {
    const listado: Cuenta[] = [
      { id: 'itau-cc', banco: 'ITAU', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'itau-mc', banco: 'ITAU', nombre: 'Tarjeta MC', tipo: 'TARJETA', numeroRef: '2853', activo: true },
      { id: 'chile-cc', banco: 'CHILE', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'chile-vi1', banco: 'CHILE', nombre: 'Tarjeta VI', tipo: 'TARJETA', numeroRef: '0455', activo: true },
      { id: 'chile-vi2', banco: 'CHILE', nombre: 'Tarjeta VI', tipo: 'TARJETA', numeroRef: '0539', activo: true },
      { id: 'bci-cc', banco: 'BCI COF', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'bci-vi', banco: 'BCI COF', nombre: 'Tarjeta VI', tipo: 'TARJETA', numeroRef: '6215', activo: true },
      { id: 'bci-mc', banco: 'BCI COF', nombre: 'Tarjeta MC', tipo: 'TARJETA', numeroRef: '6606', activo: true },
      { id: 'ob-cc', banco: 'Office Banking', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'ob-vi', banco: 'Office Banking', nombre: 'Tarjeta VI', tipo: 'TARJETA', numeroRef: '3579', activo: true },
      { id: 'be-cc', banco: 'Banco Estado', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'sco-cc', banco: 'SCO', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'sco-mc', banco: 'SCO', nombre: 'Tarjeta MC', tipo: 'TARJETA', numeroRef: '5502', activo: true },
      { id: 'bcirm-cc', banco: 'BCI RMOV', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'bcirm-vi', banco: 'BCI RMOV', nombre: 'Tarjeta VI', tipo: 'TARJETA', numeroRef: '5601', activo: true },
      { id: 'cmrc-cc', banco: 'CMR COF', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'cmrc-mc', banco: 'CMR COF', nombre: 'Tarjeta MC', tipo: 'TARJETA', numeroRef: '8117', activo: true },
      { id: 'cmrm-cc', banco: 'CMR Michelle', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'cmrm-mc', banco: 'CMR Michelle', nombre: 'Tarjeta MC', tipo: 'TARJETA', numeroRef: '6125', activo: true },
      { id: 'san-cc', banco: 'Santander COF', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'san-vi', banco: 'Santander COF', nombre: 'Tarjeta VI', tipo: 'TARJETA', numeroRef: '4111', activo: true },
      { id: 'san-mc', banco: 'Santander COF', nombre: 'Tarjeta MC', tipo: 'TARJETA', numeroRef: '8690', activo: true },
      { id: 'rip-cc', banco: 'Ripley COF', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'rip-mc', banco: 'Ripley COF', nombre: 'Tarjeta MC', tipo: 'TARJETA', numeroRef: '6773', activo: true },
      { id: 'lid-cc', banco: 'Lider COF', nombre: 'Cuenta Corriente', tipo: 'CC', numeroRef: '', activo: true },
      { id: 'lid-vi', banco: 'Lider COF', nombre: 'Tarjeta VI', tipo: 'TARJETA', numeroRef: '3013', activo: true },
    ];
    await setCuentas(listado);
    alert('Cuentas configuradas exitosamente según listado maestro.');
  };

  return (
    <GlobalStoreContext.Provider value={{
      cuentas, saldos, movimientos, cxp, cxc, ingresos, parametros, ui, suggested,
      setCuentas, setSaldos, setMovimientos, setCxP, setCxC, setIngresos, setParametros, setUI, saveSuggestion,
      loadDemoData, deleteSaldosByDate, clearMonthSaldos, importMovimientos, clearMonthMovimientos,
      importCxPFromExcel, importSaldosFromExcel,
      deleteCxP, deleteCxC, deleteIngreso, deleteMovimiento, deleteCuenta
    }}>
      {children}
    </GlobalStoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(GlobalStoreContext);
  if (!context) throw new Error('useStore must be used within a GlobalStoreProvider');
  return context;
};
