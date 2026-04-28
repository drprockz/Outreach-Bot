import React from 'react';
import { GLOSSARY } from '../content/glossary';

/**
 * Wraps a technical term so users can hover for a plain-English explanation.
 * Uses the native `title` attribute for accessibility + zero deps.
 *
 * <TechTerm id="bounceRate">Bounce rate</TechTerm>
 *
 * Throws if `id` is missing from the glossary — fail loudly so we can't ship
 * a tooltip that silently says nothing.
 */
export default function TechTerm({ id, children }) {
  const entry = GLOSSARY[id];
  if (!entry) throw new Error(`TechTerm: glossary entry "${id}" not found`);
  return (
    <span data-techterm={id} title={entry.short} className="techterm">
      {children}
      <span aria-hidden="true" className="techterm-info">ⓘ</span>
    </span>
  );
}
