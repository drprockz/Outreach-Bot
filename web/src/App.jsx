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
import FunnelAnalytics from './pages/FunnelAnalytics';
import NicheManager from './pages/NicheManager';
import EngineConfig from './pages/EngineConfig';
import IcpRules from './pages/IcpRules';
import Offer from './pages/Offer';
import IcpProfile from './pages/IcpProfile';
import EmailPersona from './pages/EmailPersona';

function ProtectedLayout() {
  const token = localStorage.getItem('radar_token');
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
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
          <Route path="/funnel" element={<FunnelAnalytics />} />
          <Route path="/settings" element={<Navigate to="/settings/niches" replace />} />
          <Route path="/settings/niches"  element={<NicheManager />} />
          <Route path="/settings/engines" element={<EngineConfig />} />
          <Route path="/settings/icp"     element={<IcpRules />} />
          <Route path="/settings/offer"   element={<Offer />} />
          <Route path="/settings/icp-profile" element={<IcpProfile />} />
          <Route path="/settings/persona" element={<EmailPersona />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
