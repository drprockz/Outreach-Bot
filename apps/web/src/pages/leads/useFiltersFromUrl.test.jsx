import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFiltersFromUrl } from './useFiltersFromUrl';

beforeEach(() => { window.history.replaceState({}, '', '/'); });

describe('useFiltersFromUrl', () => {
  it('parses URL into filters with multi-value support', () => {
    window.history.replaceState({}, '', '/?status=ready&status=queued&search=acme&icp_priority=A');
    const { result } = renderHook(() => useFiltersFromUrl());
    expect(result.current.filters.status).toEqual(['ready', 'queued']);
    expect(result.current.filters.search).toBe('acme');
    expect(result.current.filters.icp_priority).toEqual(['A']);
  });

  it('setFilter updates URL and state', () => {
    const { result } = renderHook(() => useFiltersFromUrl());
    act(() => result.current.setFilter('status', ['ready']));
    expect(window.location.search).toContain('status=ready');
    expect(result.current.filters.status).toEqual(['ready']);
  });

  it('setMany merges patch into existing filters', () => {
    window.history.replaceState({}, '', '/?status=ready');
    const { result } = renderHook(() => useFiltersFromUrl());
    act(() => result.current.setMany({ search: 'foo' }));
    expect(window.location.search).toContain('status=ready');
    expect(window.location.search).toContain('search=foo');
  });

  it('clearFilters resets URL to bare path', () => {
    window.history.replaceState({}, '', '/?status=ready');
    const { result } = renderHook(() => useFiltersFromUrl());
    act(() => result.current.clearFilters());
    expect(window.location.search).toBe('');
    expect(result.current.filters).toEqual({});
  });

  it('skips empty arrays + nulls when serializing', () => {
    const { result } = renderHook(() => useFiltersFromUrl());
    act(() => result.current.setMany({ status: [], search: '', noise: null }));
    expect(window.location.search).toBe('');
  });
});
