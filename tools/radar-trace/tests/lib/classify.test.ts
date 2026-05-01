import { describe, it, expect } from 'vitest';
import { classifyFunction, classifySeniority } from '../../src/lib/classify.js';

describe('classifyFunction', () => {
  it.each([
    ['Senior Backend Engineer', 'eng'],
    ['Frontend Developer', 'eng'],
    ['SDET', 'eng'],
    ['Account Executive', 'sales'],
    ['VP of Sales', 'sales'],
    ['Marketing Manager', 'marketing'],
    ['Brand Strategist', 'marketing'],
    ['Operations Lead', 'ops'],
    ['Finance Controller', 'finance'],
    ['Product Manager', 'product'],
    ['Senior Product Designer', 'design'],
    ['UX Researcher', 'design'],
    ['Customer Success Manager', 'cs'],
    ['Legal Counsel', 'legal'],
    ['HR Business Partner', 'hr'],
    ['Recruiter', 'hr'],
    ['Some Random Title', 'other'],
  ])('%s → %s', (title, expected) => {
    expect(classifyFunction(title)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(classifyFunction('SENIOR ENGINEER')).toBe('eng');
    expect(classifyFunction('sales engineer')).toBe('sales'); // sales wins over engineer
  });
});

describe('classifySeniority', () => {
  it.each([
    ['Intern', 'intern'],
    ['Junior Developer', 'junior'],
    ['Software Engineer', 'mid'],
    ['Senior Engineer', 'senior'],
    ['Staff Engineer', 'staff'],
    ['Principal Engineer', 'principal'],
    ['Engineering Director', 'director'],
    ['VP of Engineering', 'vp'],
    ['Chief Technology Officer', 'c-level'],
    ['CEO', 'c-level'],
    ['CTO', 'c-level'],
    ['Random Title', 'mid'],
  ])('%s → %s', (title, expected) => {
    expect(classifySeniority(title)).toBe(expected);
  });
});
