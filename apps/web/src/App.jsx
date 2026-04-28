import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { REDIRECTS } from './redirects';

import AuthGate from './components/AuthGate';
import AppShell from './components/AppShell';
import RequireSuperadmin from './components/RequireSuperadmin';

import Login from './pages/auth/Login';
import Otp from './pages/auth/Otp';

import Today from './pages/Today';
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

import Profile from './pages/settings/Profile';
import Team from './pages/settings/Team';
import Billing from './pages/settings/Billing';
import OrgSettings from './pages/settings/Org';

import Orgs from './pages/superadmin/Orgs';
import OrgDetail from './pages/superadmin/OrgDetail';
import Users from './pages/superadmin/Users';
import Metrics from './pages/superadmin/Metrics';

function OldPathRedirect() {
  const { pathname } = useLocation();
  const target = REDIRECTS[pathname];
  return <Navigate to={target || '/'} replace />;
}

function GatedShell() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/otp" element={<Otp />} />

        <Route element={<GatedShell />}>
          <Route index               element={<Today />} />
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

          <Route path="settings/profile" element={<Profile />} />
          <Route path="settings/team"    element={<Team />} />
          <Route path="settings/billing" element={<Billing />} />
          <Route path="settings/org"     element={<OrgSettings />} />

          <Route element={<RequireSuperadmin />}>
            <Route path="superadmin/orgs"      element={<Orgs />} />
            <Route path="superadmin/orgs/:id"  element={<OrgDetail />} />
            <Route path="superadmin/users"     element={<Users />} />
            <Route path="superadmin/metrics"   element={<Metrics />} />
          </Route>

          <Route path="*" element={<OldPathRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
