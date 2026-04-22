import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import Engines from './Engines';

const sampleItems = [
  {
    name: 'findLeads', enabled: true, schedule: '0 9 * * 1-6', costToday: 0.42,
    lastRun: { status: 'success', startedAt: new Date().toISOString(), durationMs: 4200, primaryCount: 28 },
  },
  {
    name: 'sendEmails', enabled: true, schedule: '30 9 * * 1-6', costToday: 0,
    lastRun: null,
  },
  {
    name: 'checkReplies', enabled: true, schedule: 'dynamic', costToday: 0,
    lastRun: { status: 'success', startedAt: new Date().toISOString(), durationMs: 800, primaryCount: 3 },
  },
  {
    name: 'sendFollowups', enabled: false, schedule: '0 18 * * 1-6', costToday: 0,
    lastRun: null,
  },
  {
    name: 'healthCheck', enabled: true, schedule: '0 2 * * 0', costToday: 0,
    lastRun: null,
  },
  {
    name: 'dailyReport', enabled: true, schedule: '30 20 * * *', costToday: 0.01,
    lastRun: { status: 'success', startedAt: new Date().toISOString(), durationMs: 500, primaryCount: 0 },
  },
];

vi.mock('../api', () => ({
  api: {
    getEngines:    vi.fn(() => Promise.resolve({ items: sampleItems })),
    getGuardrails: vi.fn(() => Promise.resolve({})),
    saveGuardrails:vi.fn(),
    getConfig:     vi.fn(() => Promise.resolve({})),
    updateConfig:  vi.fn(),
    runEngine:     vi.fn(() => Promise.resolve({ status: 200, ok: true, body: { cronLogId: 1 } })),
    cronHistory:   vi.fn(() => Promise.resolve({ history: [] })),
  },
}));

function renderPage() {
  return render(<MemoryRouter><Engines /></MemoryRouter>);
}

async function getMaster() {
  const master = await waitFor(() => {
    const el = document.querySelector('.engines-master');
    if (!el) throw new Error('master pane not mounted yet');
    return el;
  });
  return within(master);
}

describe('Engines page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the master list with all 6 engines', async () => {
    renderPage();
    const master = await getMaster();
    expect(master.getByText('findLeads')).toBeInTheDocument();
    expect(master.getByText('sendEmails')).toBeInTheDocument();
    expect(master.getByText('checkReplies')).toBeInTheDocument();
    expect(master.getByText('sendFollowups')).toBeInTheDocument();
    expect(master.getByText('healthCheck')).toBeInTheDocument();
    expect(master.getByText('dailyReport')).toBeInTheDocument();
  });

  it('shows Status tab by default and KPI cards render', async () => {
    renderPage();
    await screen.findByText('Last run status');
    expect(screen.getByText('Last run status')).toBeInTheDocument();
    // The sampled findLeads fixture has status 'success'
    expect(screen.getAllByText('success').length).toBeGreaterThan(0);
  });

  it('switches tabs when Config or Guardrails clicked (findLeads)', async () => {
    renderPage();
    await screen.findByText('Last run status');

    fireEvent.click(screen.getByRole('button', { name: 'Config' }));
    await waitFor(() => {
      expect(screen.getByText('Lead count (total per run)')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Guardrails' }));
    await waitFor(() => {
      expect(screen.getByText(/Size prompts/)).toBeInTheDocument();
    });
  });

  it('healthCheck shows only Status + History (no Config / Guardrails)', async () => {
    renderPage();
    const master = await getMaster();
    fireEvent.click(master.getByText('healthCheck'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Config' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardrails' })).not.toBeInTheDocument();
  });
});
