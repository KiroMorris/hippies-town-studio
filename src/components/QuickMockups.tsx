import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Mockup } from '../../shared/types.ts';
import { api, useAction, useDesigns, useProducts } from '../api.ts';
import { useRemembered } from './remember.ts';
import { ProductPicker } from './ProductPicker.tsx';
import { Modal, plural, useRun } from './ui.tsx';

/** Put one or more designs on many products/colors in one go. */
export function QuickMockups({ designIds, onClose }: { designIds: string[]; onClose: () => void }) {
  // The garments you picked last time are ticked again: most batches go on the same few colors.
  const { data: known = [] } = useProducts();
  const [picked, setProducts] = useRemembered<string[]>('quick.products', []);
  const products = picked.filter(id => known.some(p => p.id === id));
  // Designs go on one garment together only when they are different prints of one look (a front plus a back plus a sleeve); a batch of fronts is one mockup each.
  const { data: all = [] } = useDesigns({});
  const mine = all.filter(d => designIds.includes(d.id));
  const [combineAsked, setCombine] = useState<boolean | null>(null);
  const combine = combineAsked ?? (designIds.length > 1 && designIds.length <= 3 && mine.length === designIds.length && new Set(mine.map(d => d.placement)).size === mine.length);
  const nav = useNavigate();
  const run = useRun();
  const create = useAction((body: object) => api.post<Mockup[]>('/mockups/quick', body), [['mockups']]);
  const total = (combine ? 1 : designIds.length) * products.length;

  const submit = async () => {
    const out = await run(() => create.mutateAsync({ designIds, productIds: products, combine }), undefined);
    if (out) { onClose(); nav(out.length === 1 ? `/mockups/${out[0].id}` : '/mockups', { state: { flash: `${plural(out.length, 'mockup')} created. Select them to start a photo shoot.`, select: out.map(m => m.id) } }); }
  };

  return (
    <Modal title={`Mockups for ${plural(designIds.length, 'design')}`} onClose={onClose} wide>
      <div className="stack">
        <p className="hint">Each design is placed at its default spot (front chest, back, or sleeve) and sized in cm, so it looks consistent on every color. You can fine-tune any mockup afterwards.</p>
        {designIds.length > 1 && (
          <label className="check"><input type="checkbox" checked={combine} onChange={e => setCombine(e.target.checked)} />
            <span>Put all selected designs on the <b>same</b> garment (e.g. a front design + a back design)<br /><span className="hint">Off: one mockup per design per color.</span></span>
          </label>
        )}
        <ProductPicker value={products} onChange={setProducts} />
        <div className="row">
          <span className="hint">{total ? `Creates ${plural(total, 'mockup')}` : 'Choose at least one color'}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!total || create.isPending} title={total ? undefined : 'Choose at least one color first'} onClick={submit}>{create.isPending ? 'Rendering…' : `Create ${plural(total, 'mockup')}`}</button>
        </div>
      </div>
    </Modal>
  );
}
