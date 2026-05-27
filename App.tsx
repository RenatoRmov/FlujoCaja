
import React, { useState } from 'react';
import { GlobalStoreProvider, useStore } from './store';
import Sidebar from './components/Sidebar';
import SaldoCuentas from './pages/SaldoCuentas';
import Transferencias from './pages/Transferencias';
import CuentasPagar from './pages/CuentasPagar';
import CuentasCobrar from './pages/CuentasCobrar';
import Ingresos from './pages/Ingresos';
import FlujoCaja from './pages/FlujoCaja';
import ImportadorExcel from './pages/ImportadorExcel';
import { Database } from 'lucide-react';

const AppContent: React.FC = () => {
  const [currentPath, setCurrentPath] = useState('saldos');
  const { loadDemoData } = useStore();

  const getTitle = () => {
    switch(currentPath) {
      case 'saldos': return 'Saldo de Cuentas';
      case 'transferencias': return 'Gestión de Transferencias';
      case 'cxp': return 'Cuentas por Pagar';
      case 'cxc': return 'Cuentas por Cobrar';
      case 'ingresos': return 'Ingresos por Recibir';
      case 'flujo': return 'Flujo de Caja Proyectado';
      case 'importar': return 'Importar desde Excel';
      default: return 'Sistema Financiero';
    }
  };

  const renderPage = () => {
    switch(currentPath) {
      case 'saldos': return <SaldoCuentas />;
      case 'transferencias': return <Transferencias />;
      case 'cxp': return <CuentasPagar />;
      case 'cxc': return <CuentasCobrar />;
      case 'ingresos': return <Ingresos />;
      case 'flujo': return <FlujoCaja />;
      case 'importar': return <ImportadorExcel />;
      default: return <SaldoCuentas />;
    }
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar currentPath={currentPath} onNavigate={setCurrentPath} />
      
      <main className="flex-1 overflow-auto bg-slate-50 max-h-screen">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-slate-800">{getTitle()}</h2>
          </div>
          <div className="flex items-center gap-6">
            <button 
              onClick={loadDemoData}
              className="text-[10px] uppercase font-bold text-slate-400 hover:text-blue-600 flex items-center gap-2 px-3 py-1.5 border border-slate-100 rounded-lg hover:border-blue-100 transition-colors"
            >
              <Database className="w-3 h-3" /> Datos Demo
            </button>
            <div className="text-xs font-medium text-slate-400 uppercase tracking-tighter hidden sm:block">
              {new Intl.DateTimeFormat('es-CL', { dateStyle: 'full' }).format(new Date())}
            </div>
          </div>
        </header>
        <div className="p-8 max-w-7xl mx-auto">
          {renderPage()}
        </div>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <GlobalStoreProvider>
      <AppContent />
    </GlobalStoreProvider>
  );
};

export default App;
