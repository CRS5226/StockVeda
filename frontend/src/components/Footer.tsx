export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="max-w-[1400px] w-full mx-auto px-4 py-4 flex flex-col items-center gap-1 text-center">
        <div className="text-xs text-slate-500">
          © {year} StockVeda · Built by{" "}
          <a
            href="https://www.linkedin.com/in/chitraksh-singh/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 hover:underline"
          >
            Chitraksh
          </a>
          . All rights reserved.
        </div>
        <div className="text-[11px] text-slate-400">
          Made with <span className="text-red-500">♥</span> for the Indian market community
        </div>
      </div>
    </footer>
  );
}
