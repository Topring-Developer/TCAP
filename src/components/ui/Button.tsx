import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed",
          {
            "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500": variant === "primary",
            "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-400": variant === "secondary",
            "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500": variant === "danger",
            "text-slate-600 hover:bg-slate-100 focus:ring-slate-400": variant === "ghost",
          },
          {
            "px-2.5 py-1.5 text-xs": size === "sm",
            "px-4 py-2 text-sm": size === "md",
            "px-5 py-2.5 text-base": size === "lg",
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
