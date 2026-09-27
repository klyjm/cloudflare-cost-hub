import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api, type User } from './api';
import { Layout } from './components/Layout';
import { Login } from './components/Login';

// Route components are loaded on demand so the chart-heavy Dashboard/Services
// views (and recharts) are not in the initial bundle. Each lazily-imported
// module resolves to its named export.
const Dashboard = lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const ServicesView = lazy(() =>
  import('./components/ServicesView').then((m) => ({ default: m.ServicesView }))
);
const BudgetView = lazy(() => import('./components/BudgetView').then((m) => ({ default: m.BudgetView })));
const AlertsView = lazy(() => import('./components/AlertsView').then((m) => ({ default: m.AlertsView })));
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })));

function Spinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        if (data.authenticated && data.user) setUser(data.user);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        {user ? (
          <Route element={<Layout onLogout={handleLogout} />}>
            <Route index element={<Dashboard />} />
            <Route path="services" element={<ServicesView />} />
            <Route path="budgets" element={<BudgetView />} />
            <Route path="alerts" element={<AlertsView />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        ) : (
          <Route path="*" element={<Login />} />
        )}
      </Routes>
    </Suspense>
  );
}

export default App;
