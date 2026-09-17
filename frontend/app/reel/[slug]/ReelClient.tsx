import ProductShop from "@/components/ProductShop";
import type { Reel } from "@/lib/types";
export default function ReelClient({ reel }: { reel: Reel }) {
  return <ProductShop reel={reel} initialProducts={reel.products} />;
}
