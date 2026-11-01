import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import './cards/css/base.css';
import './cards/css/cards2.css';
import './cards/css/special.css';
import './cards/css/joker-talia.css';
import './cards/css/ufo.css';
import './cards/css/avatars.css';
import './fx/css/stage.css';
import './fx/css/fx.css';
import './styles/tokens.css';
import './styles/base.css';

import { App } from './app/App';

const queries = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
