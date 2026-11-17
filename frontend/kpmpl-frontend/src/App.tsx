import { createHashRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { HomeRedirect, RequireAuth, RequireCap } from './auth/guards';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './features/auth/LoginPage';
import { GateDashboardPage } from './features/gate/GateDashboardPage';
import { ReceivingRegisterPage } from './features/receiving/ReceivingRegisterPage';
import { NewReceivingPage } from './features/receiving/NewReceivingPage';
import { VisitDetailPage } from './features/receiving/VisitDetailPage';
import { CorrectVisitPage } from './features/receiving/CorrectVisitPage';
import { QcQueuePage } from './features/qc/QcQueuePage';
import { QcInspectionPage } from './features/qc/QcInspectionPage';
import { FollowUpListPage } from './features/followup/FollowUpListPage';
import { FollowUpPage } from './features/followup/FollowUpPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { UsersPage } from './features/admin/UsersPage';
import { ChangePasswordPage } from './features/account/ChangePasswordPage';
import { NewPackagePage, PackagePage, PackagesPage } from './features/documents/DocumentPages';
import { ErpMilestonesPage, HoInboxPage, HoReviewPage } from './features/ho/HoPages';
import { ErpGateEntriesPage, ErpGateEntryDetailPage } from './features/erp/ErpGateEntriesPage';
import { AccountingPackagePage, AccountingQueuePage } from './features/accounting/AccountingPages';
import { HomePage } from './features/home/HomePage';
import { NotFound } from './features/placeholders/NotFound';

/**
 * Hash routing keeps the prototype hostable as static files without server rewrites.
 * Switch to createBrowserRouter when deployed behind a server that rewrites to index.html.
 */
const router = createHashRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [{
      element: <AppShell />,
      children: [
        { index: true, element: <HomeRedirect /> },
        { path: 'home', element: <HomePage /> },
        { path: 'gate', element: <RequireCap cap="receiving.create"><GateDashboardPage /></RequireCap> },
        { path: 'gate/follow-up', element: <RequireCap cap="gate.followup"><FollowUpListPage /></RequireCap> },
        { path: 'gate/follow-up/:id', element: <RequireCap cap="gate.followup"><FollowUpPage /></RequireCap> },
        { path: 'receiving', element: <RequireCap cap="receiving.view"><ReceivingRegisterPage /></RequireCap> },
        { path: 'receiving/new', element: <RequireCap cap="receiving.create"><NewReceivingPage /></RequireCap> },
        { path: 'receiving/:id', element: <RequireCap cap="receiving.view"><VisitDetailPage /></RequireCap> },
        { path: 'receiving/:id/correct', element: <RequireCap cap="receiving.edit"><CorrectVisitPage /></RequireCap> },
        { path: 'qc', element: <RequireCap cap="qc.measure"><QcQueuePage /></RequireCap> },
        { path: 'qc/inspect/:visitId', element: <RequireCap cap="qc.measure"><QcInspectionPage /></RequireCap> },
        { path: 'overview', element: <RequireCap cap="overview.view"><OverviewPage /></RequireCap> },
        { path: 'account/password', element: <ChangePasswordPage /> },
        { path: 'admin/users', element: <RequireCap cap="admin.users"><UsersPage /></RequireCap> },
        { path: 'documents', element: <RequireCap cap="docs.prepare"><PackagesPage /></RequireCap> },
        { path: 'documents/new', element: <RequireCap cap="docs.prepare"><NewPackagePage /></RequireCap> },
        { path: 'documents/:id', element: <RequireCap cap="docs.prepare"><PackagePage /></RequireCap> },
        { path: 'head-office', element: <RequireCap cap="ho.inbox"><HoInboxPage /></RequireCap> },
        { path: 'head-office/:id', element: <RequireCap cap="ho.inbox"><HoReviewPage /></RequireCap> },
        { path: 'erp/gate-entries', element: <RequireCap cap="erp.read"><ErpGateEntriesPage /></RequireCap> },
        { path: 'erp/gate-entries/:docId', element: <RequireCap cap="erp.read"><ErpGateEntryDetailPage /></RequireCap> },
        { path: 'erp-milestones', element: <RequireCap cap="ho.inbox"><ErpMilestonesPage /></RequireCap> },
        { path: 'accounting', element: <RequireCap cap="accounting.inbox"><AccountingQueuePage /></RequireCap> },
        { path: 'accounting/:id', element: <RequireCap cap="accounting.inbox"><AccountingPackagePage /></RequireCap> },
        { path: '*', element: <NotFound /> },
      ],
    }],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
