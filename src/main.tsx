import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import './styles.css';
import { Layout } from './components/Layout.tsx';
import { ToastProvider } from './components/ui.tsx';
import { DesignsPage } from './pages/DesignsPage.tsx';
import { GeneratePage } from './pages/GeneratePage.tsx';
import { MockupsPage } from './pages/MockupsPage.tsx';
import { MockupEditorPage } from './pages/MockupEditorPage.tsx';
import { ShootsPage } from './pages/ShootsPage.tsx';
import { PresetsPage } from './pages/PresetsPage.tsx';
import { QueuePage } from './pages/QueuePage.tsx';
import { ProductsPage, ProductPage } from './pages/ProductsPage.tsx';
import { ShopifyPage } from './pages/ShopifyPage.tsx';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, refetchOnWindowFocus: true, retry: 1 } } });

const router = createBrowserRouter([{
  element: <Layout />,
  children: [
    { path: '/', element: <Navigate to="/designs" replace /> },
    { path: '/designs', element: <DesignsPage /> },
    { path: '/generate', element: <GeneratePage /> },
    { path: '/mockups', element: <MockupsPage /> },
    { path: '/mockups/:id', element: <MockupEditorPage /> },
    { path: '/shoots', element: <ShootsPage /> },
    { path: '/products', element: <ProductsPage /> },
    { path: '/products/:id', element: <ProductPage /> },
    { path: '/shopify', element: <ShopifyPage /> },
    { path: '/presets', element: <PresetsPage /> },
    { path: '/queue', element: <QueuePage /> },
    { path: '*', element: <Navigate to="/designs" replace /> },
  ],
}]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
