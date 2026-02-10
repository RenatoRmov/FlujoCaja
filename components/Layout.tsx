
import React, { useState } from 'react';
import Sidebar from './Sidebar';
import { getFriendlyDate } from '../utils';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
}

const Layout: React.FC<LayoutProps> = ({ children, title }) => {
  const [path, setPath] = useState('saldos');

  const renderContent = () => {
    // In a real app we'd use a router, but for this constraint we'll use conditional rendering
    const Component = (children as any).type;
    return React.cloneElement(children as React.ReactElement, { currentPath: path, setPath });
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar currentPath={path} onNavigate={setPath} />
      <main className="flex-1 flex flex-col overflow-auto max-h-screen">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <h2 className="text-xl font-bold text-slate-800">{title}</h2>
          <div className="text-sm font-medium text-slate-500">
            {getFriendlyDate(new Date().toISOString())}
          </div>
        </header>
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
