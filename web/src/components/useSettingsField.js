import { useSettingsContext } from './SettingsPage';

/**
 * Wires a single field to the surrounding <SettingsPage>. Must be called
 * inside a <SettingsPage> subtree or it throws (via useSettingsContext).
 */
export function useSettingsField(name) {
  const { values, setField, errors } = useSettingsContext();
  return {
    value: values[name],
    onChange: (v) => setField(name, v),
    error: errors[name],
  };
}
