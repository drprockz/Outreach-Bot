import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SettingsPage from './SettingsPage';
import { useSettingsField } from './useSettingsField';

function Input({ name }) {
  const { value, onChange, error } = useSettingsField(name);
  return (
    <>
      <input aria-label={name} value={value ?? ''} onChange={e => onChange(e.target.value)} />
      {error && <span role="alert">{error}</span>}
    </>
  );
}

describe('useSettingsField', () => {
  it('reads and writes values through SettingsPage context', async () => {
    const onSave = vi.fn(async () => {});
    render(
      <SettingsPage title="t" description="d" initialValues={{ foo: 'bar' }} onSave={onSave}>
        <Input name="foo" />
      </SettingsPage>
    );
    const input = screen.getByLabelText('foo');
    expect(input.value).toBe('bar');
    fireEvent.change(input, { target: { value: 'baz' } });
    expect(input.value).toBe('baz');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ foo: 'baz' }));
  });

  it('Save button is disabled until a field is dirty', () => {
    render(
      <SettingsPage title="t" description="d" initialValues={{ foo: 'bar' }} onSave={() => {}}>
        <Input name="foo" />
      </SettingsPage>
    );
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('foo'), { target: { value: 'baz' } });
    expect(saveBtn).not.toBeDisabled();
  });

  it('Reset restores the initial values and disables Save again', () => {
    render(
      <SettingsPage title="t" description="d" initialValues={{ foo: 'bar' }} onSave={() => {}}>
        <Input name="foo" />
      </SettingsPage>
    );
    fireEvent.change(screen.getByLabelText('foo'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(screen.getByLabelText('foo').value).toBe('bar');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('onValidate errors block save and surface in the field', () => {
    const onSave = vi.fn(async () => {});
    const onValidate = vi.fn(() => ({ foo: 'must not be empty' }));
    render(
      <SettingsPage
        title="t" description="d"
        initialValues={{ foo: 'bar' }}
        onValidate={onValidate}
        onSave={onSave}
      >
        <Input name="foo" />
      </SettingsPage>
    );
    fireEvent.change(screen.getByLabelText('foo'), { target: { value: 'baz' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('must not be empty');
  });

  it('throws a clear error when used outside a SettingsPage', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Input name="foo" />)).toThrow(/SettingsPage/);
    err.mockRestore();
  });
});
