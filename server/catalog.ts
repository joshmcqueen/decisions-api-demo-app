import type { Asset, CheckId, Fixture, Outcome, Product } from '../shared/domain.ts';

export const assets: Asset[] = [
  { id: 'headphones-black', productId: 'headphones', label: 'Midnight black', file: 'headphones-black.png' },
  { id: 'headphones-cream', productId: 'headphones', label: 'Warm cream', file: 'headphones-cream.png' },
  { id: 'coffee-clean', productId: 'coffee', label: 'Studio photo', file: 'coffee-clean-red.png' },
  { id: 'coffee-lifestyle', productId: 'coffee', label: 'Kitchen setting', file: 'coffee-lifestyle-red.png' },
  { id: 'plush-clean', productId: 'plush', label: 'Clean product photo', file: 'plush-clean.png' },
  { id: 'plush-promo', productId: 'plush', label: 'Promotional overlay', file: 'plush-promo.png' },
];
export const products: Product[] = [
  {
    id: 'headphones', name: 'Studio Wireless Headphones', brand: 'FORM', category: 'Electronics', sku: 'FORM-H01-BLK',
    facts: { 'Product type': 'Over-ear wireless headphones', Color: 'Matte black', Connectivity: 'Bluetooth wireless', 'Included items': 'One pair of headphones; USB-C charging cable', 'Ear cushions': 'Padded oval earcups' },
    title: 'FORM Studio Wireless Over-Ear Headphones, Matte Black',
    bullets: ['Wireless listening: Bluetooth connectivity for everyday audio', 'Cushioned comfort: Padded over-ear cushions and adjustable headband', 'In the box: One pair of matte-black headphones and a USB-C charging cable'],
    imageIds: ['headphones-black', 'headphones-cream'], thumbnail: 'headphones-black',
  },
  {
    id: 'coffee', name: 'Daily Drip Coffee Maker', brand: 'COMMON', category: 'Home & Kitchen', sku: 'COM-D08-RED',
    facts: { 'Product type': 'Drip coffee maker', Color: 'Cherry red with black trim', Capacity: '8-cup glass carafe', 'Brewing method': 'Filter-basket drip brewing only', 'Espresso function': 'Not supported; no pressure pump or espresso portafilter' },
    title: 'COMMON Daily Drip Coffee Maker, 8-Cup Glass Carafe, Cherry Red',
    bullets: ['Daily brewing: Filter-basket drip brewing for your morning coffee', 'Easy serving: An 8-cup glass carafe with a comfortable handle', 'Simple controls: A single switch for straightforward drip brewing'],
    imageIds: ['coffee-clean', 'coffee-lifestyle'], thumbnail: 'coffee-clean',
  },
  {
    id: 'plush', name: 'Little Axolotl Plush', brand: 'ODDLY', category: 'Toys & Games', sku: 'ODD-AX01-LAV',
    facts: { 'Product type': 'Axolotl plush toy', Color: 'Lavender body with pink external gills', 'Included items': 'One plush toy', Appearance: 'Smiling embroidered face; four small feet; long tapered tail', 'Safety information': 'No age, safety-certification, or suitability claims supplied' },
    title: 'ODDLY Little Axolotl Plush Toy, Lavender with Pink Gills',
    bullets: ['A little unusual: An axolotl character with a smiling embroidered face', 'Colorful details: Lavender body with pink external gills', 'One new companion: Includes one axolotl plush toy'],
    imageIds: ['plush-clean', 'plush-promo'], thumbnail: 'plush-clean',
  },
];
const allMatch = Object.fromEntries(['title_facts','bullet_facts','image_product','white_background','no_overlay'].map(id => [id, 'match'])) as Record<CheckId, Outcome>;
export const fixtures: Fixture[] = products.flatMap(p => {
  const clean = { productId: p.id, title: p.title, bullets: [...p.bullets], imageId: p.imageIds[0] };
  const bad = { ...clean, bullets: [...clean.bullets] };
  const expected = { ...allMatch };
  if (p.id === 'headphones') { bad.imageId = 'headphones-cream'; expected.image_product = 'mismatch'; }
  if (p.id === 'coffee') { bad.bullets[0] = 'Café at home: Brews rich, café-quality espresso with a crema finish'; expected.bullet_facts = 'mismatch'; }
  if (p.id === 'plush') { bad.imageId = 'plush-promo'; expected.no_overlay = 'mismatch'; }
  return [
    { id: `${p.id}-consistent`, productId: p.id, label: 'Consistent listing', variant: 'consistent' as const, listing: clean, expected: { ...allMatch } },
    { id: `${p.id}-attention`, productId: p.id, label: p.id === 'headphones' ? 'Wrong product color' : p.id === 'coffee' ? 'Conflicting feature claim' : 'Promotional main photo', variant: 'attention' as const, listing: bad, expected },
  ];
});
export const guidelines = [
  { title: 'Seller Central reference', url: 'https://sellercentral.amazon.com/help/hub/reference/external/GC3QAQ8CCXUG5RE4?locale=en-US', verified: false, description: 'User-supplied reference; full text requires verification in Seller Central.' },
  { title: 'Product title guidelines', url: 'https://sellercentral.amazon.com/help/hub/reference/external/GYTR6SYGFA5E3EQC?locale=en-US', verified: false, description: 'Seller Central reference; category-specific limits are not enforced in this demo.' },
  { title: 'Product image requirements', url: 'https://sellercentral.amazon.com/help/hub/reference/external/G1881?locale=en-US', verified: false, description: 'Seller Central reference; sign-in may be required.' },
  { title: 'Creating product listings', url: 'https://sell.amazon.com/blog/amazon-product-listings', verified: true, description: 'Public marketplace guidance on titles, bullets, images, and product details.' },
  { title: 'Product photography guidance', url: 'https://sell.amazon.com/blog/product-photos', verified: true, description: 'Public marketplace guidance on accurate photos and white backgrounds.' },
  { title: 'Bullet point requirements', url: 'https://sellercentral.amazon.com/help/hub/reference/external/GX5L8BF8GLMML6CX?language=en_us', verified: false, description: 'Seller Central reference; full policy text requires verification.' },
];
