
import React from 'react';
import { fmt } from '../utils';
import { X } from 'lucide-react';

export const KPICard: React.FC<{ title: string; value: number; color?: string; isCurrency?: boolean }> = ({ 
  title, value, color = 'blue', isCurrency = true 
}) => {
  const colors: Record<string, string> = {
    blue: 'bg-blue-600 text-white',
    green: 'bg-emerald-600 text-white',
    red: 'bg-red-600 text-white',
    white: 'bg-white text-slate-900 border border-slate-200'
  };
  
  return (
    <div className={`p-6 rounded-xl shadow-sm ${colors[color]}`}>
      <p className={`text-xs uppercase font-bold tracking-wider mb-1 opacity-80`}>{title}</p>
      <p className="text-2xl font-bold">{isCurrency ? fmt(value) : value}</p>
    </div>
  );
};

export const Modal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ isOpen, onClose, title, children, footer }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
        {footer && (
          <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export const Badge: React.FC<{ type: string; children: React.ReactNode }> = ({ type, children }) => {
  const styles: Record<string, string> = {
    ABONO: 'bg-emerald-100 text-emerald-700',
    CARGO: 'bg-red-100 text-red-700',
    TRANSFERENCIA: 'bg-blue-100 text-blue-700',
    PENDIENTE: 'bg-amber-100 text-amber-700',
    PAGADA: 'bg-emerald-100 text-emerald-700',
    PARCIAL: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${styles[type] || 'bg-slate-100 text-slate-600'}`}>
      {children}
    </span>
  );
};
