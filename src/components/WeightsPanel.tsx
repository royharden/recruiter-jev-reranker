import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { Weights, RankSettings } from '@/lib/types';
import { WEIGHT_PRESETS } from '@/lib/ranking';

interface Props {
  weights: Weights;
  settings: RankSettings;
  onWeights: (w: Weights) => void;
  onSettings: (s: RankSettings) => void;
  disabled: boolean;
}

const FIELDS: { key: keyof Omit<Weights, 'retrieval_prior'>; label: string }[] = [
  { key: 'skills', label: 'Skills' },
  { key: 'seniority', label: 'Seniority' },
  { key: 'location', label: 'Location' },
  { key: 'domain', label: 'Domain' },
];

export function WeightsPanel({ weights, settings, onWeights, onSettings, disabled }: Props) {
  const total = weights.skills + weights.seniority + weights.location + weights.domain + weights.retrieval_prior;
  const pct = (v: number) => Math.round((v / Math.max(total, 1e-9)) * 100);
  const activePreset = Object.entries(WEIGHT_PRESETS).find(
    ([, w]) =>
      w.skills === weights.skills && w.seniority === weights.seniority &&
      w.location === weights.location && w.domain === weights.domain,
  )?.[0];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
          Weights
        </h3>
        <span className="text-[11px] tabular-nums text-slate-500">normalized to {pct(weights.skills) + pct(weights.seniority) + pct(weights.location) + pct(weights.domain) + pct(weights.retrieval_prior)}%</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.keys(WEIGHT_PRESETS).map((name) => (
          <button
            key={name}
            disabled={disabled}
            onClick={() => onWeights({ ...WEIGHT_PRESETS[name], retrieval_prior: weights.retrieval_prior })}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              activePreset === name
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="space-y-3.5">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-slate-700">{label}</span>
              <span className="tabular-nums text-slate-500">{pct(weights[key])}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights[key]}
              disabled={disabled}
              onChange={(e) => onWeights({ ...weights, [key]: Number(e.target.value) })}
              className="w-full accent-indigo-600"
            />
          </div>
        ))}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-medium text-slate-700">Retrieval prior</span>
            <span className="tabular-nums text-slate-500">{pct(weights.retrieval_prior)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={weights.retrieval_prior}
            disabled={disabled}
            onChange={(e) => onWeights({ ...weights, retrieval_prior: Number(e.target.value) })}
            className="w-full accent-indigo-600"
          />
        </div>
      </div>

      <div className="space-y-2.5 pt-1 border-t border-slate-100">
        <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
          <span>Must-have gate (composite × 0.6 below 0.2)</span>
          <input
            type="checkbox"
            checked={settings.must_have_gate}
            disabled={disabled}
            onChange={(e) => onSettings({ ...settings, must_have_gate: e.target.checked })}
            className="accent-indigo-600"
          />
        </label>
        <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
          <span>Show flagged candidates in place</span>
          <input
            type="checkbox"
            checked={settings.show_flagged_in_place}
            disabled={disabled}
            onChange={(e) => onSettings({ ...settings, show_flagged_in_place: e.target.checked })}
            className="accent-indigo-600"
          />
        </label>
      </div>

      <button
        onClick={() => onWeights({ ...WEIGHT_PRESETS.Balanced, retrieval_prior: 0 })}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
      </button>
    </div>
  );
}
