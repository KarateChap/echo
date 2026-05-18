import { Link } from "react-router-dom";

export default function Rules() {
  return (
    <div className="mx-auto max-w-md px-6 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Link to="/app" className="text-sm opacity-60">← Back</Link>
        <h1 className="text-xl font-semibold">Rules</h1>
      </header>
      <p className="text-sm opacity-60">No active rules yet.</p>
    </div>
  );
}
