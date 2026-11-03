import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, ClipboardCheck, DoorOpen, FileText, FlaskConical, Inbox, ListChecks, Receipt, Scale, Send, Truck, Users, type LucideProps,
} from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../auth/AuthContext';
import { can, roleLabel } from '../../auth/permissions';
import type { RoleCode, User } from '../../domain/types';
import { isToday } from '../../lib/format';
import { cn } from '../../components/ui/cn';
import { followUpTests } from '../followup/FollowUpListPage';

type CountKey =
  | 'today' | 'needsTare' | 'readyExit' | 'grnPending' | 'qcWaiting' | 'qcDecide'
  | 'docsPrep' | 'docsSend' | 'docsFix' | 'hoCases' | 'erpPending' | 'activeUsers' | 'onPremises';

interface HomeCard {
  id: string; title: string; desc: string; to: string; icon: ComponentType<LucideProps>;
  count?: CountKey; countText?: (n: number) => string;
}
const waiting = (n: number) => `${n} waiting`;

/** 2–4 large job cards per role; secondary links stay small. */
const cardsByRole: Record<RoleCode, { main: HomeCard[]; more: HomeCard[] }> = {
  gate: {
    main: [
      { id: 'new', title: 'New truck', desc: 'A truck has arrived at the gate.', to: '/receiving/new', icon: Truck, count: 'today', countText: (n) => `${n} today` },
      { id: 'tare', title: 'Weigh empty truck', desc: 'Truck is unloaded and back on the weighbridge.', to: '/gate/follow-up?tab=needs_tare', icon: Scale, count: 'needsTare', countText: waiting },
      { id: 'exit', title: 'Let truck out', desc: 'Weighed truck is ready to leave the mill.', to: '/gate/follow-up?tab=ready_exit', icon: DoorOpen, count: 'readyExit', countText: waiting },
      { id: 'grn', title: 'Enter GRN No.', desc: 'Copy the GRN number from DataMan.', to: '/gate/follow-up?tab=grn_pending', icon: Receipt, count: 'grnPending', countText: waiting },
    ],
    more: [
      { id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks },
      { id: 'docs', title: 'Documents', desc: '', to: '/documents', icon: FileText },
      { id: 'ov', title: 'Overview', desc: '', to: '/overview', icon: BarChart3 },
    ],
  },
  qc: {
    main: [
      { id: 'qcq', title: 'Trucks waiting for QC', desc: 'Take a sample and enter the readings.', to: '/qc', icon: FlaskConical, count: 'qcWaiting', countText: waiting },
      { id: 'qcd', title: 'QC decisions to make', desc: 'Readings are in. Accept, deduct, re-check or reject.', to: '/qc?tab=submitted', icon: ClipboardCheck, count: 'qcDecide', countText: waiting },
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
      { id: 'hoc', title: 'Cases to check', desc: 'Document packages sent by the gate.', to: '/head-office', icon: Inbox, count: 'hoCases', countText: waiting },
      { id: 'erp', title: 'DataMan steps', desc: 'Plant Head approval, voucher and posting.', to: '/erp-milestones', icon: ClipboardCheck, count: 'erpPending', countText: (n) => `${n} pending` },
      { id: 'rep', title: 'Reports', desc: 'Today at the mill, in numbers.', to: '/overview', icon: BarChart3 },
    ],
    more: [{ id: 'reg', title: 'All trucks', desc: '', to: '/receiving', icon: ListChecks }],
  },
  admin: {
    main: [
      { id: 'users', title: 'Users', desc: 'Add people, set roles, reset passwords.', to: '/admin/users', icon: Users, count: 'activeUsers', countText: (n) => `${n} active` },
      { id: 'rep', title: 'Reports', desc: 'Operations overview and CSV export.', to: '/overview', icon: BarChart3 },
      { id: 'hoc', title: 'Head Office inbox', desc: 'Document packages at Head Office.', to: '/head-office', icon: Inbox, count: 'hoCases', countText: waiting },
      { id: 'reg', title: 'All trucks', desc: 'Every truck, newest first.', to: '/receiving', icon: Truck, count: 'onPremises', countText: (n) => `${n} inside` },
    ],
    more: [],
  },
};

/** Cards for every role the user holds, de-duplicated, each still behind its capability. */
export function homeCardsFor(user: User) {
  const seen = new Set<string>();
  const pick = (list: HomeCard[]) => list.filter((c) => !seen.has(c.id) && seen.add(c.id));
  const main = pick(user.roles.flatMap((r) => cardsByRole[r]?.main ?? []));
  const more = pick(user.roles.flatMap((r) => cardsByRole[r]?.more ?? []));
  return { main, more };
}

async function loadCounts(user: User, need: Set<CountKey>): Promise<Partial<Record<CountKey, number>>> {
  const out: Partial<Record<CountKey, number>> = {};
  const jobs: Promise<void>[] = [];
  if (['today', 'needsTare', 'readyExit', 'grnPending', 'onPremises'].some((k) => need.has(k as CountKey)) && can(user, 'receiving.view')) {
    jobs.push(api.listVisits({ pageSize: 500 }).then((r) => {
      const vs = r.data;
      out.today = vs.filter((v) => isToday(v.createdAt)).length;
      out.needsTare = vs.filter(followUpTests.needs_tare).length;
      out.readyExit = vs.filter(followUpTests.ready_exit).length;
      out.grnPending = vs.filter(followUpTests.grn_pending).length;
      out.onPremises = vs.filter((v) => v.exitStatus === 'on_premises').length;
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
