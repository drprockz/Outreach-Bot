import { z } from 'zod';

export const JobSchema = z.object({
  source: z.enum(['adzuna', 'careers']),
  title: z.string(),
  location: z.string().nullable(),
  date: z.string().nullable(),
  url: z.string().nullable(),
  function: z.string(),    // FunctionTag, but we accept string for forward-compat
  seniority: z.string(),   // SeniorityTag
});

export type Job = z.infer<typeof JobSchema>;
