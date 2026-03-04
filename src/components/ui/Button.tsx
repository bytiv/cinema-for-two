'use client';

import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warm';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-300 focus-ring disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      primary: 'bg-cinema-accent text-cinema-bg hover:bg-cinema-accent-light hover:shadow-[0_0_25px_rgba(232,160,191,0.4)] active:scale-[0.97]',
      secondary: 'bg-cinema-card border border-cinema-border text-cinema-text hover:border-cinema-accent/50 hover:bg-cinema-surface active:scale-[0.97]',
      ghost: 'text-cinema-text-muted hover:text-cinema-text hover:bg-cinema-card/50',
      danger: 'bg-red-500/10 border border-red-500/20 text-cinema-error hover:bg-red-500/20 hover:border-red-500/40',
      warm: 'bg-cinema-warm text-cinema-bg hover:bg-cinema-warm-light hover:shadow-[0_0_25px_rgba(251,191,126,0.4)] active:scale-[0.97]',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-5 py-2.5 text-sm',
      lg: 'px-7 py-3.5 text-base',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
