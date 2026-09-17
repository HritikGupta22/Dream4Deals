import type { Metadata } from 'next';
import { apiFetch } from '@/lib/api';
import type { Product } from '@/lib/types';
import ProductShop from '@/components/ProductShop';

export const metadata: Metadata = { title: 'Shop all products | Dream4Deals' };

export default async function ShopPage() {
  const data = await apiFetch<{ products: Product[] }>('/api/products', { cache: 'no-store' }).catch(() => null);
  if (!data || !Array.isArray(data.products)) {
    return <main className="shop-section"><h1 className="font-serif text-4xl">Shop all products</h1><p className="mt-4">We couldn’t load the products. Please try again.</p><a href="/shop" className="inline-block mt-4 underline">Retry</a></main>;
  }
  return <ProductShop initialProducts={data.products} />;
}
