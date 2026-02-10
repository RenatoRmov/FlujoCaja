
import React from 'react';
import { 
  Wallet, 
  ArrowLeftRight, 
  CreditCard, 
  HandCoins, 
  TrendingUp, 
  LayoutDashboard 
} from 'lucide-react';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  const menuItems = [
    { id: 'saldos', label: 'Saldo Cuentas', icon: Wallet },
    { id: 'transferencias', label: 'Transferencias y Pagos', icon: ArrowLeftRight },
    { id: 'cxp', label: 'Cuentas por Pagar', icon: CreditCard },
    { id: 'cxc', label: 'Cuentas por Cobrar', icon: HandCoins },
    { id: 'ingresos', label: 'Ingresos por Recibir', icon: TrendingUp },
    { id: 'flujo', label: 'Flujo de Caja', icon: LayoutDashboard },
  ];

  return (
    <aside className="w-72 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0 z-30">
      <div className="p-8 border-b border-slate-100 bg-slate-50/30">
        <h1 className="text-xl font-black text-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="leading-none">Sistema Financiero</span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter mt-1">RadioMóvil NuevaHuechuraba</span>
          </div>
        </h1>
      </div>
      <nav className="flex-1 p-6 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-4 px-5 py-4 text-sm font-bold rounded-xl transition-all ${
                isActive 
                  ? 'bg-blue-600 text-white shadow-xl shadow-blue-100 transform scale-[1.02]' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="p-6 border-t border-slate-100">
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
           <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
           <span className="text-[10px] font-bold text-slate-500 uppercase">Estado Local: Persistente</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
