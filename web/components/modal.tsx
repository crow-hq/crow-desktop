"use client";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "./util";

export function Modal({
  title,
  onClose,
  children,
  footer,
  className,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "anim-pop flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl shadow-black/60 sm:max-h-[88dvh] sm:max-w-[800px] sm:rounded-2xl",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <h2 className="min-w-0 truncate text-lg font-medium">{title}</h2>
          <button className="icon-btn shrink-0" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">{children}</div>
        {footer && <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-7">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-muted/40 border-t-accent"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}
