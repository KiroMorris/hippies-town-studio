import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { reportNetwork } from './components/connection.tsx';
import type {
  QueuePause,
  Design, GenerateDesignsRequest, ShopifyProfilesSummary, ShopifySyncResult, Listing, ListingDetail, GenerateShootsRequest, Job, Mockup, Preset, PresetKind, Product, Reference, Shoot, ShotTemplate,
} from '../shared/types.ts';

export class ApiError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  let res: Response;
  try { res = await fetch(`/api${url}`, init); }
  catch (e) { // no answer at all: offline, the home connection dropped, or the Studio is down
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    reportNetwork(false);
    throw new ApiError(navigator.onLine === false ? "You're offline. Check your connection and try again." : "Can't reach the Studio. Check your connection and try again.");
  }
  const down = res.status === 502 || res.status === 503 || res.status === 504; // the web server answers for a Studio server that is not running
  reportNetwork(!down);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || (down ? "The Studio isn't answering right now. It may be restarting; try again in a moment." : res.status === 401 || res.status === 403 ? 'You need to sign in again. Reload the page.' : res.status === 413 ? 'That file is too big to send.' : `Something went wrong (error ${res.status}). Try again.`));
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  return s.size ? `?${s}` : '';
};

export interface Stats { queue: { queued: number; running: number; concurrency: number; lastError: string | null; paused: QueuePause | null }; counts: { designs: number; mockups: number; shoots: number; listings: number } }

/** Poll while anything is generating so new results appear on their own. */
const useActivePoll = () => {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats'), refetchInterval: 3000 });
  return stats.data && stats.data.queue.queued + stats.data.queue.running > 0 ? 4000 : false;
};

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats'), refetchInterval: 3000 });
export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products'), staleTime: Infinity });
export const useShotTemplates = () => useQuery({ queryKey: ['shot-templates'], queryFn: () => api.get<ShotTemplate[]>('/shot-templates'), staleTime: Infinity });

export interface DesignFilter { status?: string; placement?: string; favorite?: boolean; q?: string; batch?: string; set?: string }
export const useDesigns = (f: DesignFilter = {}) => {
  const poll = useActivePoll();
  return useQuery({ queryKey: ['designs', f], queryFn: () => api.get<Design[]>(`/designs${qs({ ...f, favorite: f.favorite ? 1 : undefined })}`), refetchInterval: poll });
};
export const useReferences = () => useQuery({ queryKey: ['references'], queryFn: () => api.get<Reference[]>('/references') });
export const useMockups = (design?: string) => useQuery({ queryKey: ['mockups', design ?? null], queryFn: () => api.get<Mockup[]>(`/mockups${qs({ design })}`) });
export const useMockup = (id: string | undefined) => useQuery({ queryKey: ['mockup', id], queryFn: () => api.get<Mockup>(`/mockups/${id}`), enabled: !!id });
export const usePresets = (kind?: PresetKind) => {
  const poll = useActivePoll();
  return useQuery({ queryKey: ['presets', kind ?? null], queryFn: () => api.get<Preset[]>(`/presets${qs({ kind })}`), refetchInterval: poll });
};
export const useShoots = (f: { mockup?: string; listing?: string; batch?: string; kind?: string; model?: string; favorite?: boolean } = {}) => {
  const poll = useActivePoll();
  return useQuery({ queryKey: ['shoots', f], queryFn: () => api.get<Shoot[]>(`/shoots${qs({ ...f, favorite: f.favorite ? 1 : undefined })}`), refetchInterval: poll });
};
export const useListings = () => {
  const poll = useActivePoll();
  return useQuery({ queryKey: ['listings'], queryFn: () => api.get<Listing[]>('/listings'), refetchInterval: poll });
};
export const useListing = (id: string | undefined) => {
  const poll = useActivePoll();
  return useQuery({ queryKey: ['listing', id], queryFn: () => api.get<ListingDetail>(`/listings/${id}`), enabled: !!id, refetchInterval: poll });
};
export const useShopifyStatus = () => useQuery({ queryKey: ['shopify-status'], queryFn: () => api.get<{ configured: boolean; domain: string | null; shop: string | null; error: string | null }>('/shopify/status'), staleTime: 60_000 });
export const useShopifyProfiles = () => useQuery({ queryKey: ['shopify-profiles'], queryFn: () => api.get<ShopifyProfilesSummary | { none: true }>('/shopify/profiles'), staleTime: 5 * 60_000 });
/** Keeps "on Shopify" honest: asks Shopify whether the linked products still exist, on a timer and whenever you come back to the Studio. */
export const useShopifySync = (enabled: boolean, onChange?: (r: ShopifySyncResult) => void) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['shopify-sync'], enabled, staleTime: 0, refetchInterval: 60_000, refetchOnWindowFocus: 'always', retry: false,
    queryFn: async () => {
      const r = await api.post<ShopifySyncResult>('/shopify/sync');
      if (r.changed.length) { qc.invalidateQueries({ queryKey: ['listings'] }); qc.invalidateQueries({ queryKey: ['listing'] }); onChange?.(r); }
      return r;
    },
  });
};
export const useJobs = (status?: 'active', enabled = true) => useQuery({ queryKey: ['jobs', status ?? 'all'], queryFn: () => api.get<Job[]>(`/jobs${qs({ status })}`), refetchInterval: 2500, enabled });

/** Mutation that invalidates the given query keys on success. */
export function useAction<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { for (const key of [...invalidate, ['stats'], ['jobs']]) qc.invalidateQueries({ queryKey: key }); } });
}

export const uploadForm = (files: File[], extra: Record<string, string> = {}) => {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
};

// ---------- Claude helper (server/assist.ts): the Studio's AI chat on the owner's Claude login ----------
export type AssistBox = 'shoot' | 'model' | 'location' | 'studio' | 'style' | 'design' | 'refine';
export interface ShotIdea { title: string; shot: string; /** medium, full, wide or close */ size: string; place: string; notes: string }
export interface PhotoParts { place: string; look: string; pose: string; shot: string }
export interface PrintCheckResult { verdict: 'ok' | 'fix'; problems: string[]; fix: string }
export interface ModelRanking { best: string; ranking: { id: string; score: number; good: string[]; problems: string[] }[] }
export const claude = {
  improve: (field: AssistBox, text: string, context?: string) => api.post<{ text: string; changed: string }>('/assist/improve', { field, text, context }),
  describeModel: (idea: string, gender?: string, age?: string) => api.post<{ description: string }>('/assist/describe-model', { idea, gender, age }),
  ideas: (body: { mockupIds: string[]; modelId?: string | null; theme?: string; count?: number; same?: boolean }) => api.post<{ ideas: ShotIdea[] }>('/shoots/ideas', body),
  runIdeas: (body: { mockupIds: string[]; modelId?: string | null; styleId?: string | null; ratio?: string; ideas: ShotIdea[] }) => api.post<{ batchId: string; jobIds: string[]; skipped: number }>('/shoots/ideas/run', body),
  caption: (id: string, body: { platform: 'instagram' | 'tiktok'; length: 'short' | 'medium'; context?: string }) => api.post<Shoot>(`/shoots/${id}/caption`, body),
  readPhoto: (file: File) => { const f = new FormData(); f.append('image', file); return api.post<PhotoParts>('/assist/read-photo', f); },
  checkPrint: (shootId: string) => api.post<PrintCheckResult>(`/shoots/${shootId}/check`),
  compareOptions: (group: string) => api.post<ModelRanking>(`/presets/options/${group}/review`),
};

export type { GenerateDesignsRequest, GenerateShootsRequest };
