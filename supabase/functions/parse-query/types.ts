export interface RoleSpec {
  title: string;
  must_have: string[];
  nice_to_have: string[];
  seniority: 'junior' | 'mid' | 'senior' | 'staff';
  seniority_description: string;
  min_years: number | null;
  location: {
    text: string;
    accepted_countries: string[];
    remote: 'remote' | 'hybrid' | 'onsite';
    overlap_window: { start_utc_hour: number; end_utc_hour: number } | null;
  };
  domain: string;
}
