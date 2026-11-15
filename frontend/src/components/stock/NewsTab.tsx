import { newsTime, fmtNewsDate } from "../../lib/stockFormat";
import type { NewsItem } from "../../lib/api";

/** Recent news headlines, newest first. */
export default function NewsTab({ newsLoading, newsItems }: { newsLoading: boolean; newsItems: NewsItem[] }) {
  return (
    newsLoading ? (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    ) : newsItems.length === 0 ? (
      <div className="text-xs text-slate-400 py-6 text-center">No recent news available.</div>
    ) : (
      <div className="flex flex-col divide-y divide-slate-50">
        {[...newsItems]
          .sort((a, b) => newsTime(b.published_at) - newsTime(a.published_at))
          .map((item, i) => (
          <div key={i} className="py-2.5 first:pt-0">
            <a href={item.link} target="_blank" rel="noopener noreferrer"
              className="text-xs font-medium text-slate-700 hover:text-blue-600 transition-colors leading-snug block mb-1">
              {item.title}
            </a>
            <div className="flex gap-2 text-xs text-slate-400">
              {item.source && <span>{item.source}</span>}
              {item.published_at && <span>· {fmtNewsDate(item.published_at)}</span>}
            </div>
          </div>
        ))}
      </div>
    )
  );
}
