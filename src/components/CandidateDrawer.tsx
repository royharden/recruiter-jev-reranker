import { X, Mail, MapPin, GraduationCap, ShieldCheck } from 'lucide-react';
import type { RankedCandidate } from '@/lib/types';

export function CandidateDrawer({ item, onClose }: { item: RankedCandidate | null; onClose: () => void }) {
  if (!item) return null;
  const c = item.candidate;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/30" />
      <aside
        className="relative w-full max-w-md bg-white h-full shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold">
              {c.initials}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{c.full_name}</p>
              <p className="text-xs text-slate-500">{c.headline}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-5 text-sm">
          <p className="flex items-start gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            Jev never saw the name or email — only headline, skills, experience, location, and summary.
          </p>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><p className="text-slate-400 font-medium">Location</p><p className="text-slate-700 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{c.city}, {c.country} (UTC{c.utc_offset >= 0 ? '+' : ''}{c.utc_offset})</p></div>
            <div><p className="text-slate-400 font-medium">Preference</p><p className="text-slate-700 capitalize mt-0.5">{c.remote_preference}{c.open_to_relocate ? ' · open to relocate' : ''}</p></div>
            <div><p className="text-slate-400 font-medium">Work auth</p><p className="text-slate-700 mt-0.5">{c.work_authorization}</p></div>
            <div><p className="text-slate-400 font-medium">Email</p><p className="text-slate-700 flex items-center gap-1 mt-0.5"><Mail className="w-3 h-3" />{c.email}</p></div>
          </div>

          <div>
            <p className="text-slate-400 font-medium text-xs mb-1.5">Skills</p>
            <div className="flex flex-wrap gap-1">
              {c.skills.map((s) => <span key={s} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">{s}</span>)}
            </div>
          </div>

          <div>
            <p className="text-slate-400 font-medium text-xs mb-1.5">Experience</p>
            <div className="space-y-3">
              {c.experience.map((e, i) => (
                <div key={i} className="border-l-2 border-indigo-200 pl-3">
                  <p className="text-xs font-semibold text-slate-800">{e.title} · {e.company}</p>
                  <p className="text-[10px] text-slate-400">{e.start} – {e.end ?? 'present'}</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{e.summary}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-slate-400 font-medium text-xs mb-1 flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5" />Education</p>
            <p className="text-xs text-slate-600">{c.education}</p>
          </div>

          <div>
            <p className="text-slate-400 font-medium text-xs mb-1">Summary</p>
            <p className="text-xs text-slate-600 leading-relaxed">{c.summary}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
