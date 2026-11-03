import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { useFormSubmit } from './SafeForm';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from './cn';

/**
 * primary   solid ink, the one next action on a screen
 * secondary 1px ink outline (e.g. "Attach PDF")
 * ghost     plain text link styled action ("Cancel", "Open")
 * danger    brick outline, for a destructive step that opens a confirm
 * dangerSolid brick fill, only for the final destructive confirm in a dialog
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid';
type Size = 'md' | 'lg' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'border border-brand-600 bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:border-brand-700 disabled:border-paper-deep disabled:bg-paper-deep disabled:text-faint disabled:shadow-none',
  secondary: 'border border-field bg-surface text-ink hover:border-brand-600 hover:bg-brand-50 disabled:border-field disabled:text-faint disabled:bg-transparent',
  ghost: 'border border-transparent !px-1 bg-transparent text-brand-700 underline decoration-brand-100 underline-offset-[4px] hover:decoration-brand-700 disabled:text-faint disabled:no-underline',
  danger: 'border border-problem bg-surface text-problem hover:bg-problem-bg disabled:border-field disabled:text-faint',
  dangerSolid: 'border border-problem bg-problem text-paper hover:bg-[#86271a] disabled:opacity-60',
};
// 40px tap targets on phones; 36px (32px small) on desktop.
const sizes: Record<Size, string> = {
  sm: 'h-11 px-3.5 text-[15px]',
  md: 'h-12 px-5 text-[16px]',
  lg: 'h-14 px-7 text-[17px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, children, className, disabled, type = 'button', onClick, ...rest }, ref,
) {
  const submit = useFormSubmit();
  // Inside a SafeForm a submit button calls the handler itself (native submit may be sandbox-blocked).
  const viaCtx = type === 'submit' && !!submit;
  return (
    <button
      ref={ref}
      type={viaCtx ? 'button' : type}
      onClick={(e) => { onClick?.(e); if (viaCtx && !e.defaultPrevented) submit(); }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn('inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed', sizes[size], variants[variant], className);
}

/** Navigation styled as a button (avoids nesting <button> inside <a>). */
export function ButtonLink({ variant, size, className, children, ...rest }: LinkProps & { variant?: Variant; size?: Size }) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
