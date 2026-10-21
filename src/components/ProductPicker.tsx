import { useMemo, useState } from 'react';
import { smallUrl, type Product } from '../../shared/types.ts';
import { useProducts } from '../api.ts';

const TYPES: { key: Product['type']; label: string }[] = [
  { key: 't-shirt', label: 'T-shirts' },
  { key: 'crewneck', label: 'Crewnecks' },
  { key: 'hoodie', label: 'Hoodies' },
  { key: 'long-sleeves', label: 'Long sleeves' },
];

/** Pick one or many products (style + color), grouped by garment type and style. */
export function ProductPicker({ value, onChange, multiple = true, onlyStyle, initialType }: {
  value: string[]; onChange: (ids: string[]) => void; multiple?: boolean; onlyStyle?: string; initialType?: Product['type'];
}) {
  const { data: products = [] } = useProducts();
  const first = products.find(p => value.includes(p.id));
  const [type, setType] = useState<Product['type']>(first?.type ?? initialType ?? 'crewneck');
  const visible = useMemo(() => products.filter(p => (onlyStyle ? p.style === onlyStyle : p.type === type)), [products, type, onlyStyle]);
  const styles = [...new Set(visible.map(p => p.style))];
  const toggle = (id: string) => onChange(multiple ? (value.includes(id) ? value.filter(v => v !== id) : [...value, id]) : [id]);

  return (
    <div className="stack picker" style={{ gap: 12 }}>
      {!onlyStyle && (
        <div className="row">
          <div className="type-tabs" role="group" aria-label="Garment type">{TYPES.map(t => <button key={t.key} className={type === t.key ? 'on' : ''} aria-pressed={type === t.key} onClick={() => setType(t.key)}>{t.label}</button>)}</div>
          {multiple && value.length > 0 && <span className="hint">{value.length} selected · <button className="btn ghost sm" onClick={() => onChange([])}>Clear</button></span>}
        </div>
      )}
      {styles.map(style => {
        const items = visible.filter(p => p.style === style);
        const allOn = items.every(p => value.includes(p.id));
        return (
          <div key={style} className="stack" style={{ gap: 8 }}>
            <div className="row">
              <span className="label">{style}</span>
              {multiple && <button className="btn ghost sm" title={allOn ? `Unselect every ${style} color` : `Select every ${style} color`} onClick={() => onChange(allOn ? value.filter(v => !items.some(p => p.id === v)) : [...new Set([...value, ...items.map(p => p.id)])])}>{allOn ? 'Unselect all' : 'All colors'}</button>}
            </div>
            <div className="product-grid">
              {items.map(p => (
                <button key={p.id} className={`product-tile${value.includes(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={value.includes(p.id)} title={`${style} · ${p.color}`}>
                  <img src={smallUrl(p.images.front)} alt="" loading="lazy" decoding="async" />
                  <span><b>{p.color}</b></span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
