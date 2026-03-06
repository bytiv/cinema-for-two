'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AdminModeContextType {
  adminMode: boolean;
  toggleAdminMode: () => void;
}

const AdminModeContext = createContext<AdminModeContextType>({
  adminMode: false,
  toggleAdminMode: () => {},
});

export function AdminModeProvider({ children }: { children: ReactNode }) {
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('cinemaAdminMode');
    if (stored === 'true') setAdminMode(true);
  }, []);

  function toggleAdminMode() {
    setAdminMode((prev) => {
      const next = !prev;
      localStorage.setItem('cinemaAdminMode', String(next));
      return next;
    });
  }

  return (
    <AdminModeContext.Provider value={{ adminMode, toggleAdminMode }}>
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode() {
  return useContext(AdminModeContext);
}