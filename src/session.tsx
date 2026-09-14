import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch, ApiError } from './api/client';
import type { SessionAccountStatus } from '../shared/types';

export type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: SessionAccountStatus }
  | { status: 'unauthorized' }
  | { status: 'unavailable' };

const SessionContext = createContext<SessionState>({ status: 'loading' });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const reload = useMemo(
    () => () => {
      setState({ status: 'loading' });
      apiFetch<SessionAccountStatus>('/api/v1/account/status')
        .then((session) => setState({ status: 'ready', session }))
        .catch((error: unknown) => {
          if (error instanceof ApiError) {
            if (error.status === 401 || error.status === 403) {
              setState({ status: 'unauthorized' });
              return;
            }
            if (error.status === 503) {
              setState({ status: 'unavailable' });
              return;
            }
          }
          setState({ status: 'unavailable' });
        });
    },
    [],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(
    () => (state.status === 'ready' ? { ...state, reload } : state),
    [state, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState & { reload?: () => void } {
  return useContext(SessionContext);
}