import { ViewLink } from '../../components/ui/Layout';
export function NotFound() {
  return (
    <div className="py-10">
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em]">Page not found</h1>
      <p className="mt-2 text-muted">The address may be wrong, or the page has moved.</p>
      <ViewLink to="/" className="mt-5">Go to your start page</ViewLink>
    </div>
  );
}
