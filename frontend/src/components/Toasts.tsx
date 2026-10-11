import { useApp } from "../state/AppContext";
import { clsx } from "./ui";

const kindStyles = {
  info: "border-stone-700 bg-stone-800 text-stone-200",
  success: "border-emerald-700 bg-emerald-950 text-emerald-200",
  error: "border-red-700 bg-red-950 text-red-200",
};

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={clsx(
            "pointer-events-auto max-w-xl rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur",
            kindStyles[t.kind],
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}