type StatCardProps = {
  label: string;
  value: string;
  change: string;
  tone: 'cyan' | 'emerald' | 'amber' | 'violet';
};

const toneClasses: Record<StatCardProps['tone'], string> = {
  cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
};

export function StatCard({ label, value, change, tone }: StatCardProps) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-xs uppercase tracking-[0.25em] text-slate-300">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-2">
        <strong className="text-3xl font-semibold text-white">{value}</strong>
        <span className="text-xs font-medium text-slate-200">{change}</span>
      </div>
    </div>
  );
}
