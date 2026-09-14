import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { SessionProvider, useSession } from './session';
import AppShell from './components/AppShell';
import { LoadingState } from './components/ui';
import Overview from './pages/Overview';
import Subscription from './pages/Subscription';
import Agents from './pages/Agents';
import Licenses from './pages/Licenses';
import LicenseDetail from './pages/LicenseDetail';
import Usage from './pages/Usage';
import Requests from './pages/Requests';
import RequestNew from './pages/RequestNew';
import RequestDetail from './pages/RequestDetail';
import Account from './pages/Account';
import Unauthorized from './pages/Unauthorized';
import ServiceUnavailable from './pages/ServiceUnavailable';

/**
 * The gate owns routing for every session state. Public pages always render;
 * protected pages render only for a verified session, and any other URL
 * redirects to the correct state page. This guarantees the app never stalls
 * on a loading/redirect hop regardless of the entry URL.
 */
function Gate() {
  const sessionState = useSession();

  if (sessionState.status === 'loading') {
    return (
      <div className="full-screen-state">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }

  if (sessionState.status === 'ready') {
    return (
      <Routes>
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="/service-unavailable" element={<ServiceUnavailable />} />
        <Route element={<AppShell session={sessionState.session} />}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/subscription" element={<Subscription />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/licenses" element={<Licenses />} />
          <Route path="/licenses/:licenseId" element={<LicenseDetail />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/requests/new" element={<RequestNew />} />
          <Route path="/requests/:requestId" element={<RequestDetail />} />
          <Route path="/account" element={<Account />} />
        </Route>
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    );
  }

  if (sessionState.status === 'unauthorized') {
    return (
      <Routes>
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="/service-unavailable" element={<ServiceUnavailable />} />
        <Route path="*" element={<Navigate to="/unauthorized" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/service-unavailable" element={<ServiceUnavailable />} />
      <Route path="*" element={<Navigate to="/service-unavailable" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </SessionProvider>
  );
}