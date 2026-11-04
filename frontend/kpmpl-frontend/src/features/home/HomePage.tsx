import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, Calculator, ClipboardCheck, DoorOpen, FileText, FlaskConical, Inbox, ListChecks, Receipt, Scale, Send, Stamp, Truck, Users, type LucideProps,
} from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { can, roleLabel, type Capability } from '../../auth/permissions';
import type { RoleCode, User } from '../../domain/types';
import { cn } from '../../components/ui/cn';

type CountKey =
  | 'today' | 'needsTare' | 'readyExit' | 'grnPending' | 'qcWaiting' | 'qcDecide'
  | 'docsPrep' | 'docsSend' | 'docsFix' | 'hoCases' | 'erpPending' | 'activeUsers' | 'onPremises'
  | 'acctNew' | 'acctMine' | 'acctHead' | 'acctPost';

interface HomeCard {
  id: string; title: string; desc: string; to: string; icon: ComponentType<LucideProps>;
  count?: CountKey; countText?: (n: number) => string;
  /** F-08: the card is shown only if the user holds this capability. */
  cap?: Capability;
}
const waiting = (n: number) => `${n} waiting`;

/** 2–4 large job cards per role; secondary links stay small. */
const cardsByRole: Record<RoleCode, { main: HomeCard[]; more: HomeCard[] }> = {
  gate: {
    main: [
      { id: 'new', title: 'New truck', desc: 'A truck has arrived at the gate.', to: '/receiving/new', icon: Truck, count: 'today', countText: (n) => `${n} today`, cap: 'receiving.create' },
      { id: 'tare', title: 'Weigh empty truck', desc: 'Truck is unloaded and back on the weighbridge.', to: '/gate/follow-up?tab=needs_tare', icon: Scale, count: 'needsTare', countText: waiting, cap: 'gate.followup' },
      { id: 'exit', title: 'Let truck out', desc: 'Weighed truck is ready to leave the mill.', to: '/gate/follow-up?tab=ready_exit', icon: DoorOpen, count: 'readyExit', countText: waiting, cap: 'gate.followup' },
      { id: 'grn', title: 'Enter GRN No.', desc: 'Copy the GRN number from DataMan.', to: '/gate/follow-up?tab=grn_pending', icon: Receipt, count: 'grnPending', countText: waiting, cap: 'gate.followup' },
    ],
    more: [
      { id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks },
      { id: 'ov', title: 'Overview', desc: '', to: '/overview', icon: BarChart3 },
    ],
  },
  gate_doc_authority: {
    main: [
      { id: 'dprep', title: 'Documents to prepare', desc: 'Attach the papers for each supplier invoice.', to: '/documents', icon: FileText, count: 'docsPrep', countText: waiting, cap: 'docs.prepare' },
      { id: 'dsend', title: 'Check and send to Head Office', desc: 'Packages ready for your check.', to: '/documents?tab=prep', icon: Send, count: 'docsSend', countText: waiting, cap: 'docs.submit' },
      { id: 'dfix', title: 'Corrections asked by HO', desc: 'Head Office sent a package back.', to: '/documents?tab=fix', icon: ListChecks, count: 'docsFix', countText: waiting, cap: 'docs.submit' },
    ],
    more: [
      { id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks },
      { id: 'ov', title: 'Overview', desc: '', to: '/overview', icon: BarChart3 },
    ],
  },
  qc: {
    main: [
      { id: 'qcq', title: 'Trucks waiting for QC', desc: 'Take a sample and enter the readings.', to: '/qc', icon: FlaskConical, count: 'qcWaiting', countText: waiting, cap: 'qc.measure' },
      { id: 'qcd', title: 'QC decisions to make', desc: 'Readings are in. Accept, deduct, re-check or reject.', to: '/qc?tab=submitted', icon: ClipboardCheck, count: 'qcDecide', countText: waiting, cap: 'qc.measure' },
    ],
    more: [
      { id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks },
      { id: 'ov', title: 'Overview', desc: '', to: '/overview', icon: BarChart3 },
    ],
  },
  gate_doc: {
    main: [
      { id: 'dprep', title: 'Documents to prepare', desc: 'Attach the papers for each supplier invoice.', to: '/documents', icon: FileText, count: 'docsPrep', countText: waiting },
      { id: 'dsend', title: 'Check and send to Head Office', desc: 'Packages ready for your check.', to: '/documents?tab=prep', icon: Send, count: 'docsSend', countText: waiting },
      { id: 'dfix', title: 'Corrections asked by HO', desc: 'Head Office sent a package back.', to: '/documents?tab=fix', icon: ListChecks, count: 'docsFix', countText: waiting },
    ],
    more: [
      { id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks },
      { id: 'ov', title: 'Overview', desc: '', to: '/overview', icon: BarChart3 },
    ],
  },
  ho: {
    main: [
      { id: 'hoc', title: 'Cases to check', desc: 'Document packages sent by the gate.', to: '/head-office', icon: Inbox, count: 'hoCases', countText: waiting, cap: 'ho.inbox' },
      { id: 'erp', title: 'DataMan steps', desc: 'Plant Head approval, voucher and posting.', to: '/erp-milestones', icon: ClipboardCheck, count: 'erpPending', countText: (n) => `${n} pending`, cap: 'ho.inbox' },
      { id: 'rep', title: 'Reports', desc: 'Today at the mill, in numbers.', to: '/overview', icon: BarChart3 },
    ],
    more: [{ id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks }],
  },
  accountant: {
    main: [
      { id: 'acct-new', title: 'New from Head Office', desc: 'Verified packages waiting for accounting.', to: '/accounting?tab=new', icon: Inbox, count: 'acctNew', countText: waiting, cap: 'accounting.inbox' },
      { id: 'acct-mine', title: 'Continue accounting', desc: 'Packages you are checking now.', to: '/accounting?tab=accountant', icon: Calculator, count: 'acctMine', countText: waiting, cap: 'accounting.inbox' },
    ],
    more: [
      { id: 'acct-posted', title: 'Posted bills', desc: '', to: '/accounting?tab=posted', icon: Receipt },
      { id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks },
      { id: 'ov', title: 'Overview', desc: '', to: '/overview', icon: BarChart3 },
    ],
  },
  head_accountant: {
    main: [
      { id: 'acct-head', title: 'To approve', desc: 'The Accountant handed these over.', to: '/accounting?tab=head', icon: ClipboardCheck, count: 'acctHead', countText: waiting },
      { id: 'acct-post', title: 'Ready to post', desc: 'Approved packages waiting for the bill.', to: '/accounting?tab=approved', icon: Stamp, count: 'acctPost', countText: waiting },
    ],
    more: [
      { id: 'acct-new', title: 'New from Head Office', desc: '', to: '/accounting?tab=new', icon: Inbox },
      { id: 'acct-posted', title: 'Posted bills', desc: '', to: '/accounting?tab=posted', icon: Receipt },
      { id: 'ov', title: 'Overview', desc: '', to: '/overview', icon: BarChart3 },
    ],
  },
  admin: {
    main: [
      { id: 'users', title: 'Users', desc: 'Add people, set roles, reset passwords.', to: '/admin/users', icon: Users, count: 'activeUsers', countText: (n) => `${n} active`, cap: 'admin.users' },
      { id: 'rep', title: 'Reports', desc: 'Operations overview and CSV export.', to: '/overview', icon: BarChart3 },
      { id: 'hoc', title: 'Head Office inbox', desc: 'Document packages at Head Office.', to: '/head-office', icon: Inbox, count: 'hoCases', countText: waiting },
      { id: 'reg', title: 'All trucks', desc: 'Every truck, newest first.', to: '/receiving', icon: Truck, count: 'onPremises', countText: (n) => `${n} inside` },
    ],
    more: [],
  },
};

/** Cards for every role the user holds, de-duplicated and filtered by capability (F-08). */
export function homeCardsFor(user: User) {
  const seen = new Set<string>();
  const pick = (list: HomeCard[]) => list.filter((c) => !seen.has(c.id) && seen.add(c.id) && (!c.cap || can(user, c.cap)));
  const main = pick(user.roles.flatMap((r) => cardsByRole[r]?.main ?? []));
  const more = pick(user.roles.flatMap((r) => cardsByRole[r]?.more ?? []));
  return { main, more };
}

async function loadCounts(user: User, need: Set<CountKey>): Promise<Partial<Record<CountKey, number>>> {
  const out: Partial<Record<CountKey, number>> = {};
  const jobs: Promise<void>[] = [];
  // F-14: these counters come from the server-side overview (computed in SQL, IST day),
  // not from a 500-row page fetch that silently caps on a busy day.
  if (['today', 'needsTare', 'readyExit', 'grnPending', 'onPremises'].some((k) => need.has(k as CountKey)) && can(user, 'overview.view')) {
    jobs.push(api.getOverview().then((o) => {
      out.today = o.receiving.today;
      out.needsTare = o.gate.needsTare;
      out.readyExit = o.gate.readyToExit;
      out.grnPending = o.gate.grnPending;
      out.onPremises = o.receiving.onPremises;
    }));
  }
  if ((need.has('qcWaiting') || need.has('qcDecide')) && can(user, 'qc.measure')) {
    jobs.push(api.getQcQueue().then((q) => {
      out.qcWaiting = q.filter((i) => ['pending', 'in_progress', 'returned'].includes(i.visit.qcStatus)).length;
      out.qcDecide = q.filter((i) => i.visit.qcStatus === 'submitted').length;
    }));
  }
  if (['docsPrep', 'docsSend', 'docsFix'].some((k) => need.has(k as CountKey)) && can(user, 'docs.prepare')) {
    jobs.push(api.listPackages('gate').then((ps) => {
      out.docsPrep = ps.filter((p) => ['draft', 'ready_for_gate_check', 'correction_requested'].includes(p.status)).length;
      out.docsSend = ps.filter((p) => p.status === 'ready_for_gate_check').length;
      out.docsFix = ps.filter((p) => p.status === 'correction_requested').length;
    }));
  }
  if ((need.has('hoCases') || need.has('erpPending')) && can(user, 'ho.inbox')) {
    jobs.push(api.listPackages('ho').then((ps) => {
      out.hoCases = ps.filter((p) => ['submitted_to_ho', 'resubmitted', 'under_ho_review'].includes(p.status)).length;
      out.erpPending = ps.filter((p) => p.erp.some((m) => m.status === 'pending')).length;
    }));
  }
  if (['acctNew', 'acctMine', 'acctHead', 'acctPost'].some((k) => need.has(k as CountKey)) && can(user, 'accounting.inbox')) {
    jobs.push(api.listPackages('accounting').then((ps) => {
      out.acctNew = ps.filter((p) => p.status === 'verified').length;
      out.acctMine = ps.filter((p) => p.status === 'with_accounting').length;
      out.acctHead = ps.filter((p) => p.status === 'with_head_accountant').length;
      out.acctPost = ps.filter((p) => p.status === 'accounting_approved').length;
    }));
  }
  if (need.has('activeUsers') && can(user, 'admin.users')) {
    jobs.push(api.listUsers().then((us) => { out.activeUsers = us.filter((u) => u.active).length; }));
  }
  // One failing source must not blank the whole screen: missing counts just show no badge.
  await Promise.allSettled(jobs);
  return out;
}

const hello = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Role home: the jobs this person does, as large cards with live counts. */
export function HomePage() {
  const { user } = useAuth();
  const cards = user ? homeCardsFor(user) : { main: [], more: [] };
  const need = new Set(cards.main.map((c) => c.count).filter(Boolean) as CountKey[]);
  const counts = useAsync(() => (user ? loadCounts(user, need) : Promise.resolve({})), [user?.id]);
  const c: Partial<Record<CountKey, number>> = counts.state.data ?? {};
  if (!user) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <p className="text-[17px] text-muted">{hello()}, {user.displayName}</p>
        <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.01em] text-ink">What do you want to do?</h1>
        <p className="mt-1 text-[16px] text-muted">{user.roles.map((r) => roleLabel[r]).join(' · ')}</p>
      </header>

      <ul className={cn('grid gap-4', cards.main.length > 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2')}>
        {cards.main.map((card) => {
          const n = card.count ? c[card.count] : undefined;
          const Icon = card.icon;
          const hot = n !== undefined && n > 0 && card.countText === waiting;
          return (
            <li key={card.id}>
              <Link to={card.to} className="group flex h-full min-h-[132px] items-start gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-sm transition hover:border-brand-600 hover:shadow-md focus-visible:outline-3 focus-visible:outline-offset-2 sm:p-6">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 group-hover:bg-brand-600 group-hover:text-white">
                  <Icon aria-hidden size={28} strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[20px] font-semibold leading-snug text-ink">{card.title}</span>
                    {n !== undefined && card.countText && (
                      <span className={cn('rounded-full px-3 py-1 text-[15px] font-semibold tabular',
                        hot ? 'bg-brand-600 text-white' : 'bg-paper-deep text-ink-soft')}>{card.countText(n)}</span>
                    )}
                  </span>
                  <span className="text-[16px] text-muted">{card.desc}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {cards.more.length > 0 && (
        <nav aria-label="More" className="mt-8 flex flex-wrap gap-3">
          {cards.more.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.id} to={m.to} className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-rule bg-surface px-4 text-[16px] font-medium text-ink hover:border-brand-600 hover:text-brand-700">
                <Icon aria-hidden size={20} strokeWidth={1.75} />{m.title}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
