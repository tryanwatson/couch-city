import { Routes, Route, Navigate } from 'react-router-dom';
import HostPage from './pages/HostPage';
import JoinPage from './pages/JoinPage';

export default function App() {
  return (
    <Routes>
      <Route path="/host" element={<HostPage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="*" element={<Navigate to="/join" replace />} />
    </Routes>
  );
}
