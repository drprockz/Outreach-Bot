import { execFile } from 'node:child_process';

export const name = 'tech_stack';
export const timeoutMs = 12000;

const CLI_TIMEOUT_MS = 10000;

function runCli(url) {
  return new Promise((resolve) => {
    execFile(
      'wappalyzer',
      [url, '--no-recursion', '--max-wait=5000'],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout);
      },
    );
  });
}

function parseTechnologies(stdout) {
  try {
    const data = JSON.parse(stdout);
    const techs = Array.isArray(data?.technologies) ? data.technologies : [];
    const technologies = techs.map(t => t.name).filter(Boolean);
    const categories = [...new Set(techs.flatMap(t => (t.categories || []).map(c => c.name)).filter(Boolean))];
    return { technologies, categories };
  } catch {
    return { technologies: [], categories: [] };
  }
}

export async function fetch(lead) {
  if (!lead.websiteUrl) return { source: name, signals: [], error: null, durationMs: 0 };

  const stdout = await runCli(lead.websiteUrl);
  if (!stdout) return { source: name, signals: [], error: null, durationMs: 0 };

  const { technologies, categories } = parseTechnologies(stdout);
  if (technologies.length === 0) return { source: name, signals: [], error: null, durationMs: 0 };

  return {
    source: name,
    signals: [{
      signalType: 'tech',
      headline: `Detected: ${technologies.slice(0, 3).join(', ')}${technologies.length > 3 ? ` (+${technologies.length - 3})` : ''}`,
      url: null,
      payload: { technologies, categories },
      confidence: 0.85,
      signalDate: null,
    }],
    error: null,
    durationMs: 0,
  };
}
