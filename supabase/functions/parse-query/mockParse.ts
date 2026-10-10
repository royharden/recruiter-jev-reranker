import { COUNTRIES, DOMAINS, SENIORITY_WORDS, US_CITIES, findSkillsInText } from './skills.ts';
import type { RoleSpec } from './types.ts';

export const PRESET_QUERIES: { key: string; label: string; query: string }[] = [
  {
    key: 'preset1',
    label: 'Senior full-stack (React/TS/Node, remote US)',
    query:
      'Senior full-stack engineer, React + TypeScript + Node + Postgres, remote US with ET overlap, 5+ years, B2B SaaS.',
  },
  {
    key: 'preset2',
    label: 'ML platform engineer (Python, k8s, Berlin/EU)',
    query:
      'ML platform engineer, Python, Kubernetes, feature stores, Berlin hybrid or EU remote, 4+ years.',
  },
  {
    key: 'preset3',
    label: 'Founding mobile engineer (RN + Swift, SF onsite)',
    query:
      'Founding mobile engineer, React Native and Swift, on-site in San Francisco, 3+ years, consumer apps.',
  },
];

export const PRESET_SPECS: Record<string, RoleSpec> = {
  preset1: {
    title: 'Senior Full-Stack Engineer',
    must_have: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
    nice_to_have: ['Next.js', 'AWS', 'GraphQL'],
    seniority: 'senior',
    seniority_description: 'owns features end to end and mentors others',
    min_years: 5,
    location: {
      text: 'Remote, United States only, must overlap 9am-3pm US Eastern',
      accepted_countries: ['USA'],
      remote: 'remote',
      overlap_window: { start_utc_hour: 14, end_utc_hour: 20 },
    },
    domain: 'B2B SaaS',
  },
  preset2: {
    title: 'ML Platform Engineer',
    must_have: ['Python', 'Kubernetes', 'Feast'],
    nice_to_have: ['Airflow', 'dbt', 'Spark'],
    seniority: 'senior',
    seniority_description: 'owns ML infrastructure end to end and sets standards for other teams',
    min_years: 4,
    location: {
      text: 'Berlin hybrid or EU remote',
      accepted_countries: ['Germany', 'Poland', 'Netherlands', 'Sweden', 'Denmark', 'Norway', 'Ireland', 'UK', 'France', 'Spain', 'Portugal', 'Italy', 'Belgium', 'Switzerland', 'Bulgaria', 'Austria'],
      remote: 'hybrid',
      overlap_window: { start_utc_hour: 8, end_utc_hour: 17 },
    },
    domain: 'ML infrastructure',
  },
  preset3: {
    title: 'Founding Mobile Engineer',
    must_have: ['React Native', 'Swift'],
    nice_to_have: ['Expo', 'TypeScript', 'Firebase'],
    seniority: 'senior',
    seniority_description: 'owns the mobile app end to end as an early employee',
    min_years: 3,
    location: {
      text: 'On-site in San Francisco, USA',
      accepted_countries: ['USA'],
      remote: 'onsite',
      overlap_window: { start_utc_hour: 16, end_utc_hour: 24 },
    },
    domain: 'Consumer apps',
  },
};

const REMOTE_RE = /\b(remote|work from home|distributed)\b/i;
const HYBRID_RE = /\bhybrid\b/i;
const ONSITE_RE = /\b(on-?site|in[- ]office|in[- ]person)\b/i;
const YEARS_RE = /(\d+)\s*\+?\s*years?/i;

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

// Rule-based parser so the demo works with no LLM key (Mock mode / fallback).
export function parseQueryMock(queryText: string): RoleSpec {
  const skills = findSkillsInText(queryText);
  const lower = queryText.toLowerCase();

  let seniority: RoleSpec['seniority'] = 'mid';
  let seniorityWord = 'mid';
  for (const [word, level] of Object.entries(SENIORITY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
      if (['staff', 'principal', 'lead', 'vp', 'director'].includes(word)) { seniority = 'staff'; seniorityWord = word; break; }
      if (word === 'senior') { seniority = 'senior'; seniorityWord = word; break; }
      if (word === 'junior' || word === 'entry') { seniority = 'junior'; seniorityWord = word; break; }
      seniority = level; seniorityWord = word;
    }
  }
  const seniorityDescriptions: Record<RoleSpec['seniority'], string> = {
    junior: 'early-career, needs guidance and close review',
    mid: 'owns tasks independently, moderate scope',
    senior: 'owns features end to end and mentors others',
    staff: 'owns systems and cross-team technical direction',
  };

  const yearsMatch = YEARS_RE.exec(queryText);
  const min_years = yearsMatch ? Number(yearsMatch[1]) : null;

  const remote = ONSITE_RE.test(lower) ? 'onsite' : HYBRID_RE.test(lower) ? 'hybrid' : REMOTE_RE.test(lower) ? 'remote' : 'remote';

  const accepted: string[] = [];
  for (const country of COUNTRIES) {
    if (lower.includes(country)) accepted.push(titleCase(country));
  }
  if (US_CITIES.some((c) => lower.includes(c)) && !accepted.includes('USA')) accepted.push('USA');

  const overlapMatch = /(\d{1,2})(?::\d{2})?\s*(am|pm)?.*?(?:to|-|until)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/i.exec(queryText);
  let overlap_window: RoleSpec['location']['overlap_window'] = null;
  const etMatch = /\bet\b|eastern/i.test(lower);
  if (etMatch) {
    overlap_window = { start_utc_hour: 14, end_utc_hour: 20 };
  } else if (overlapMatch) {
    const s = Number(overlapMatch[1]) + (overlapMatch[2]?.toLowerCase() === 'pm' && Number(overlapMatch[1]) < 12 ? 12 : 0);
    const e = Number(overlapMatch[3]) + (overlapMatch[4]?.toLowerCase() === 'pm' && Number(overlapMatch[3]) < 12 ? 12 : 0);
    if (e > s && e <= 24) overlap_window = { start_utc_hour: s, end_utc_hour: e };
  }

  let domain = 'General software';
  for (const d of DOMAINS) {
    if (lower.includes(d)) { domain = titleCase(d); break; }
  }

  const titleMatch = /\b(engineer|developer|designer|manager|scientist)\b/i.exec(queryText);
  const title = titleMatch
    ? `${seniority === 'staff' ? 'Staff' : seniority === 'senior' ? 'Senior' : titleCase(seniorityWord)} ${titleMatch[0].replace(/^\w/, (m) => m.toUpperCase())}`
    : 'Software Engineer';

  const locationText = queryText.match(/(remote|hybrid|on-?site)[^.]*$/i)?.[0]?.trim() || (remote === 'remote' ? 'Remote' : 'On-site');

  return {
    title,
    must_have: skills.slice(0, 6),
    nice_to_have: skills.slice(6, 10),
    seniority,
    seniority_description: seniorityDescriptions[seniority],
    min_years,
    location: { text: locationText, accepted_countries: accepted, remote, overlap_window },
    domain,
  };
}
