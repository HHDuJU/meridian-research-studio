import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "font-sans bg-card text-foreground border-border shadow-[var(--shadow-border)]",
        },
      }}
    />
  );
}
