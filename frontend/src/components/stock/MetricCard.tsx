/** A small labelled number on the stock page. */
export default function MetricCard({ label, value, icon: Icon, up }: {
  label: string; value: string; icon?: React.ElementType; up?: boolean;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
        {Icon && <Icon size={11} />}{label}
      </div>
      <div className={`text-sm font-bold ${up === true ? "text-emerald-600" : up === false ? "text-red-500" : "text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}
