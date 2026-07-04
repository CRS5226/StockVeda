export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="max-w-[1400px] w-full mx-auto px-4 py-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center whitespace-nowrap">
        <span className="text-xs text-slate-500">
          © {year} StockVeda · Built by{" "}
          <a
            href="https://www.linkedin.com/in/chitraksh-singh/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 hover:underline"
          >
            Chitraksh
          </a>
          . All rights reserved. ·{" "}
          <a
            href="https://github.com/CRS5226/StockVeda"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 hover:underline"
          >
            GitHub
          </a>
        </span>
        <span className="text-slate-300">·</span>
        <span className="text-[11px] text-slate-400">
          Made with <span className="text-purple-500">♥</span> for the Indian market community
        </span>
        <span className="text-slate-300">·</span>
        <span className="text-[10px] text-slate-300">
          For educational purposes only — not investment advice.
        </span>
      </div>
    </footer>
  );
}
