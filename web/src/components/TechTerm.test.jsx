import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TechTerm from './TechTerm';

describe('TechTerm', () => {
  it('wraps a term with tooltip content from the glossary', () => {
    render(<TechTerm id="bounceRate">bounce rate</TechTerm>);
    const term = screen.getByText('bounce rate');
    expect(term).toBeInTheDocument();
    // The info glyph is present
    expect(screen.getByText('ⓘ')).toBeInTheDocument();
    // The tooltip lives in the title attribute for a11y + native hover
    const wrapper = term.closest('[data-techterm]');
    expect(wrapper).toHaveAttribute('title', expect.stringContaining('under 2%'));
    expect(wrapper).toHaveAttribute('data-techterm', 'bounceRate');
  });

  it('throws a clear error when id is missing from the glossary', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TechTerm id="notAGlossaryEntry">x</TechTerm>))
      .toThrow(/glossary/i);
    err.mockRestore();
  });
});
