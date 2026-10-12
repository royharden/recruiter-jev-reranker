export interface Experience {
  title: string;
  company: string;
  start: string; // "YYYY-MM"
  end: string | null;
  summary: string;
}

export type RemotePreference = 'remote' | 'hybrid' | 'onsite';

export interface Candidate {
  id: string;
  slug: string;
  full_name: string;
  initials: string;
  headline: string;
  city: string;
  country: string;
  utc_offset: number;
  remote_preference: RemotePreference;
  open_to_relocate: boolean;
  work_authorization: string;
  skills: string[];
  experience: Experience[];
  education: string;
  summary: string;
  email: string;
  embedding?: string | null;
}
