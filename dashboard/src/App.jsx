import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Overview from './pages/Overview';
import LeadPipeline from './pages/LeadPipeline';
import SendLog from './pages/SendLog';
import ReplyFeed from './pages/ReplyFeed';
import SequenceTracker from './pages/SequenceTracker';
import CronStatus from './pages/CronStatus';
import HealthMonitor from './pages/HealthMonitor';
import CostTracker from './pages/CostTracker';
import ErrorLog from './pages/ErrorLog';

function ProtectedLayout() {
  const token = localStorage.getItem('radar_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f0f0f' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '24px 32px', overflowY: 'auto', maxHeight: '100vh' }}>
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/leads" element={<LeadPipeline />} />
          <Route path="/send-log" element={<SendLog />} />
          <Route path="/replies" element={<ReplyFeed />} />
          <Route path="/sequences" element={<SequenceTracker />} />
          <Route path="/cron" element={<CronStatus />} />
          <Route path="/health" element={<HealthMonitor />} />
          <Route path="/costs" element={<CostTracker />} />
          <Route path="/errors" element={<ErrorLog />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
