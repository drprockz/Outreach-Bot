import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BulkActionBar from './BulkActionBar';

describe('BulkActionBar', () => {
  it('hidden when no leads selected', () => {
    const { container } = render(<BulkActionBar selectedIds={[]} onAction={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows selection count', () => {
    render(<BulkActionBar selectedIds={[1, 2, 3]} onAction={() => {}} />);
    expect(screen.getByText(/3 selected/)).toBeInTheDocument();
  });

  it('calls onAction with status:nurture when clicked', () => {
    const onAction = vi.fn();
    render(<BulkActionBar selectedIds={[1]} onAction={onAction} />);
    fireEvent.click(screen.getByText(/Mark as nurture/));
    expect(onAction).toHaveBeenCalledWith({ kind: 'status', action: 'nurture' });
  });

  it('opens retry dropdown and calls onAction with retry:regen_hook', () => {
    const onAction = vi.fn();
    render(<BulkActionBar selectedIds={[1]} onAction={onAction} />);
    fireEvent.click(screen.getByText(/Retry ▾/));
    fireEvent.click(screen.getByText('regen_hook'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'retry', stage: 'regen_hook' });
  });
});
