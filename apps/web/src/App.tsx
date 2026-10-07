import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Lobby } from './pages/Lobby';
import { Login } from './pages/Login';
import { TablePage } from './pages/TablePage';

export function App() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <div className="flex h-full items-center justify-center text-zinc-400">Loading…</div>;
  }
  if (status === 'signedOut') return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/table/:id" element={<TablePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
