import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import { REDIRECTS } from './redirects';

// Temporary — replaced by real pages in PR 6:
import Overview from './pages/Overview';              // Today placeholder (PR 6 replaces)

import Engines from './pages/Engines';
import OfferAndIcp from './pages/OfferAndIcp';

import Leads from './pages/Leads';
import SentEmails from './pages/SentEmails';
import Followups from './pages/Followups';
import Replies from './pages/Replies';
import Funnel from './pages/Funnel';
import Niches from './pages/Niches';
import EmailVoice from './pages/EmailVoice';
import Spend from './pages/Spend';
import EmailHealth from './pages/EmailHealth';
import Errors from './pages/Errors';
import ScheduleLogs from './pages/ScheduleLogs';

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

// Catches any path not matched by a real route. If the path was a pre-reshape
// URL (e.g. /leads, /settings/offer) we 301-equivalent to its new home via
// REDIRECTS; otherwise we land at /.
function OldPathRedirect() {
  const { pathname } = useLocation();
  const target = REDIRECTS[pathname];
  return <Navigate to={target || '/'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route index               element={<Overview />} />
          <Route path="outreach/engines"   element={<Engines />} />
          <Route path="outreach/leads"     element={<Leads />} />
          <Route path="outreach/sent"      element={<SentEmails />} />
          <Route path="outreach/followups" element={<Followups />} />
          <Route path="outreach/replies"   element={<Replies />} />
          <Route path="outreach/funnel"    element={<Funnel />} />
          <Route path="setup/niches"       element={<Niches />} />
          <Route path="setup/offer-icp"    element={<OfferAndIcp />} />
          <Route path="setup/voice"        element={<EmailVoice />} />
          <Route path="system/spend"        element={<Spend />} />
          <Route path="system/email-health" element={<EmailHealth />} />
          <Route path="system/errors"       element={<Errors />} />
          <Route path="system/logs"         element={<ScheduleLogs />} />
          <Route path="*" element={<OldPathRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
