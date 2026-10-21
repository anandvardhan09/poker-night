import { Navigate, Route, Routes } from 'react-router-dom';
import { InviteToast } from './components/InviteToast';
import { useAuth } from './lib/auth';
import { Leaderboard } from './pages/Leaderboard';
import { Lobby } from './pages/Lobby';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { TablePage } from './pages/TablePage';

export function App() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <div className="flex h-full items-center justify-center text-zinc-400">Loading…</div>;
  }
  if (status === 'signedOut') return <Login />;
  return (
    <>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/table/:id" element={<TablePage />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/:id" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InviteToast />
    </>
  );
}
