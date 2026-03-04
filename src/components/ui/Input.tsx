'use client';

import { cn } from '@/lib/utils';
import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-cinema-text-muted">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-cinema-text-dim">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={id}
            className={cn(
              'w-full rounded-xl bg-cinema-card border border-cinema-border px-4 py-3 text-cinema-text',
              'placeholder:text-cinema-text-dim',
              'focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20',
              'transition-all duration-200',
              icon && 'pl-10',
              error && 'border-cinema-error/50 focus:border-cinema-error focus:ring-cinema-error/20',
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p className="text-sm text-cinema-error">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
