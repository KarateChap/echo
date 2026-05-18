import { useParams } from "react-router-dom";

export default function Claim() {
  const { token } = useParams();
  return (
    <div className="mx-auto max-w-md px-6 py-8 text-center">
      <h1 className="mb-2 text-2xl font-semibold">You have a message.</h1>
      <p className="text-sm opacity-60">Claim token: {token}</p>
      <p className="mt-6 text-sm opacity-60">Claim flow coming soon.</p>
    </div>
  );
}
