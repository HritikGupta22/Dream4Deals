"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { apiFetch, apiPost, money } from "@/lib/api";
import type { Offer, PlatformOffers, Reel, Seller } from "@/lib/types";

function normalizeOffers(data: PlatformOffers[] | Offer[] | null | undefined): PlatformOffers[] {
  if (!Array.isArray(data) || data.length === 0) return [];

  if ((data[0] as PlatformOffers)?.sellers) {
    return data as PlatformOffers[];
  }

  const grouped = new Map<string, { platform: string; sellers: Seller[] }>();

  (data as Offer[]).forEach((offer) => {
    const platform = offer.platform || "Unknown";
    const seller = {
      seller: offer.seller || platform,
      price: Number(offer.price ?? 0),
      rating: offer.rating || "",
      delivery: offer.delivery || "",
      link: offer.link || "#",
    };

    const existing = grouped.get(platform);
    if (existing) {
      existing.sellers.push(seller);
    } else {
      grouped.set(platform, { platform, sellers: [seller] });
    }
  });

  return Array.from(grouped.values()).map((group) => ({
    platform: group.platform,
    sellers: [...group.sellers].sort((a, b) => (a.price > 0 ? a.price : Infinity) - (b.price > 0 ? b.price : Infinity)),
  }));
}

function sellerLinksToOffers(product: Reel["products"][number]): PlatformOffers[] {
  if (!product.sellerLinks || product.sellerLinks.length === 0) return [];

  const grouped: { [key: string]: Seller[] } = {};

  product.sellerLinks.forEach((link) => {
    const platform = link.platform || "Unknown";
    if (!grouped[platform]) grouped[platform] = [];

    grouped[platform].push({
      seller: link.seller || platform,
      price: Number(link.price ?? 0),
      rating: link.rating || "",
      delivery: link.delivery || "",
      link: link.url || "#",
      sizes: link.sizes,
      reason: link.reason,
      checkedAt: link.checkedAt,
    });
  });

  return Object.entries(grouped).map(([platform, sellers]) => ({
    platform,
    sellers: [...sellers].sort((a, b) => (a.price > 0 ? a.price : Infinity) - (b.price > 0 ? b.price : Infinity)),
  }));
}

export default function ProductShop({ reel, initialProducts }: { reel?: Reel; initialProducts: Reel["products"] }) {
  const [offers, setOffers] = useState<PlatformOffers[]>([]);
  const [selected, setSelected] = useState<Reel["products"][number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingPrices, setCheckingPrices] = useState(Boolean(reel));
  const [priceLookupFailed, setPriceLookupFailed] = useState(false);

  const requestId = useRef(0);
  const selectedId = useRef<string | null>(null);
  const [products, setProducts] = useState(initialProducts);
  useEffect(() => {
    if (!reel) return;
    const controller = new AbortController();
    apiFetch<{ products: Reel['products'] }>(`/api/reels/${encodeURIComponent(reel.slug)}/prices`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted || !Array.isArray(data.products)) return;
        setProducts(data.products);
        const activeProduct = data.products.find(product => product.id === selectedId.current);
        if (activeProduct?.sellerLinks?.length) setOffers(sellerLinksToOffers(activeProduct));
      }).catch(() => {
        if (!controller.signal.aborted) setPriceLookupFailed(true);
      }).finally(() => {
        if (!controller.signal.aborted) setCheckingPrices(false);
      });
    return () => controller.abort();
  }, [reel]);

  async function openComparison(id: string) {
    const product = products.find((p) => p.id === id)!;
    if (product.sellerLinks?.length === 1) return;
    const request = ++requestId.current;
    selectedId.current = id;
    setSelected(product);
    setOffers([]);
    setLoading(true);
    setTimeout(() => document.getElementById("comparison")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

    if (product.sellerLinks?.length) {
      setOffers(sellerLinksToOffers(product));
      setLoading(false);
      return;
    }

    try {
      const data = await apiFetch<PlatformOffers[] | Offer[]>(`/api/offers/product/${id}`);
      if (request !== requestId.current) return;
      const backendOffers = normalizeOffers(data);

      if (backendOffers.length > 0) {
        setSelected(product);
        setOffers(backendOffers);
      } else {
        const fallbackOffers = sellerLinksToOffers(product);
        setSelected(product);
        setOffers(fallbackOffers);
      }

    } catch {
      if (request !== requestId.current) return;
      // console.error("Error fetching offers");

      const fallbackOffers = sellerLinksToOffers(product);
      setSelected(product);
      setOffers(fallbackOffers);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }

  function lowestKey(platforms: PlatformOffers[]) {
    const all: (Seller & { platform: string })[] = platforms.flatMap((g) =>
      (g.sellers ?? []).map((s) => ({ ...s, platform: g.platform }))
    );
    const lowest = all.filter(seller => Number.isFinite(seller.price) && seller.price > 0).sort((a, b) => (a.price > 0 ? a.price : Infinity) - (b.price > 0 ? b.price : Infinity))[0];
    return lowest ? `${lowest.platform}|${lowest.seller}|${lowest.price}` : "";
  }

  const best = lowestKey(offers);

  return (
    <main>
      {reel && <section className="reel-intro">
        <div className="reel-cover relative overflow-hidden">
          <Image src={reel.poster || "/placeholder.jpg"} alt={`Post by ${reel.creator.name}`} fill sizes="(max-width: 640px) 100vw, 420px" className="object-cover" priority />
          <span className="absolute bottom-4 left-4 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold">As seen on Instagram</span>
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f9e4dc] text-[#a64234] font-bold" aria-hidden="true">{reel.creator.name.charAt(0)}</span>
          <div><p className="text-sm font-semibold">{reel.creator.name}</p><p className="text-xs text-[#716966]">{reel.creator.handle}</p></div>
          <a href="#shop" className="ml-auto text-sm font-semibold text-[#a64234]">Explore finds &darr;</a>
        </div>
      </section>}

      {/* Products */}
      <section id="shop" className="shop-section">
        <p className="text-[11px] font-bold tracking-[1.5px] text-[#e96050] mb-3">YOUR NEXT GREAT FIND</p>
        <h2 className="font-serif text-[30px] md:text-[40px] tracking-[-1px] m-0">Spotted it. Shop it.</h2>
        <p className="text-[#716966] text-[13px] mt-2 mb-8">Shop an item directly or compare sellers when more stores are available.</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
          {products.map((p) => {
            const singleLink = p.sellerLinks?.length === 1 ? p.sellerLinks[0] : null;
            if (singleLink) {
              const price = singleLink.price ?? p.price;
              const redirect = `/api/redirect?platform=${encodeURIComponent(singleLink.platform)}&product=${encodeURIComponent(p.name)}&url=${encodeURIComponent(singleLink.url)}`;
              return (
                <article key={p.id} className="product-card bg-white text-left">
                  <div className="relative aspect-[4/5] bg-[#f5f1ed]">
                    <Image src={p.image} alt={p.name} fill sizes="(max-width: 640px) 45vw, (max-width: 1024px) 43vw, 28vw" className="object-contain" />
                  </div>
                  <div className="p-3 sm:p-4">
                    <h3 className="text-[14px] m-0">{p.name}</h3>
                    <p className="text-[12px] text-[#716966] my-1.5 capitalize">{singleLink.platform}</p>
                    <b className="block text-[14px]">{price > 0 ? money(price) : checkingPrices ? "Checking price..." : "Check price at store"}</b>
                    {!!singleLink.sizes?.length && <small className="block text-[#716966] text-[11px] mt-1">Sizes listed: {singleLink.sizes.join(', ')}. Confirm stock at store.</small>}
                    {singleLink.checkedAt && price > 0 && <small className="block text-[#716966] text-[11px]">Price checked {new Date(singleLink.checkedAt).toLocaleString('en-IN')}</small>}
                    <a
                      href={redirect}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Visit ${singleLink.platform} for ${p.name}`}
                      onClick={() => {
                        requestId.current++;
                        selectedId.current = null;
                        setSelected(null);
                        setLoading(false);
                        apiPost("/api/click", { product: p.name, platform: singleLink.platform, seller: singleLink.seller || singleLink.platform }).catch(() => {});
                      }}
                      className="block bg-[#241d1d] text-white no-underline px-3 py-2 text-[12px] mt-3 text-center hover:bg-[#3a2f2f]"
                    >
                      Buy Now
                    </a>
                  </div>
                </article>
              );
            }
            return (
            <button
              type="button"
              aria-label={`Compare sellers for ${p.name}`}
              key={p.id}
              onClick={() => openComparison(p.id)}
              className="product-card bg-white text-left cursor-pointer transition-transform hover:-translate-y-1"
            >
              <div className="relative aspect-[4/5] bg-[#f5f1ed]">
                <Image src={p.image} alt={p.name} fill sizes="(max-width: 640px) 45vw, (max-width: 1024px) 43vw, 28vw" className="object-contain" />
              </div>
              <div className="p-3 sm:p-4">
                <h3 className="text-[14px] m-0">{p.name}</h3>
                <p className="text-[12px] text-[#716966] my-1.5">{p.category === "uncategorized" ? "" : p.category}</p>
                <b className="block text-[14px]">{p.price > 0 ? `From ${money(p.price)}` : checkingPrices ? "Checking price..." : "Check price at store"}</b>
                <span className="block mt-2 text-[#a64234] text-[12px] font-bold">Compare →</span>
              </div>
            </button>
            );
          })}
        </div>
      </section>

      {products.length === 0 && <p className="px-6 pb-12 text-center text-[#716966]">New finds are on their way. Check back soon.</p>}

      {/* Comparison panel */}
      {selected && (
        <section id="comparison" className="px-[5vw] md:px-[10vw] py-[65px] bg-[#fff0eb] grid md:grid-cols-[290px_1fr] gap-[30px] md:gap-[52px] relative">
          <button
            onClick={() => { requestId.current++; selectedId.current = null; setSelected(null); setLoading(false); }}
            className="absolute right-6 top-4 border-0 bg-transparent text-[30px] cursor-pointer"
            aria-label="Close"
          >×</button>
          <div className="relative h-[370px]">
            <Image src={selected.image} alt={selected.name} fill sizes="(max-width: 768px) 90vw, 290px" className="object-contain" />
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-[1.5px] text-[#e96050] mb-3">COMPARE PRICES</p>
            <h2 className="font-serif text-[34px] tracking-[-1.5px] mb-4">{selected.name}</h2>

            {loading ? (
              <p className="text-[13px] text-[#716966]">Loading seller options...</p>
            ) : offers.length === 0 ? (
              <p className="text-[13px] text-[#716966]">No seller options available for this product yet.</p>
            ) : (
              <>
                <p role="status" className="text-[13px] bg-white rounded-xl p-3 mb-2">{checkingPrices ? "Checking current store prices..." : priceLookupFailed ? "Store details could not be refreshed. Visit the store for current prices." : best ? "The lowest listed price is highlighted. Confirm the latest price at the store." : "Live prices are unavailable. Visit a store to check its current price and availability."}</p>
                {offers.map((group) => (
                  <div key={group.platform} className="mt-5">
                    <h3 className="text-[14px] font-bold mb-2 capitalize">{group.platform}</h3>
                    {[...(group.sellers ?? [])].sort((a, b) => (a.price > 0 ? a.price : Infinity) - (b.price > 0 ? b.price : Infinity)).map((offer) => {
                      const key = `${group.platform}|${offer.seller}|${offer.price}`;
                      const redirect = `/api/redirect?platform=${encodeURIComponent(group.platform)}&product=${encodeURIComponent(selected.name)}&url=${encodeURIComponent(offer.link)}`;
                      return (
                        <div
                          key={`${key}|${offer.link}`}
                          className={`bg-white p-3 my-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 ${key === best ? "outline outline-1 outline-[#e8a196] bg-green-50" : ""}`}
                        >
                          <div>
                            <b className="block text-[13px]">{offer.seller}{key === best ? " · Lowest price" : ""}</b>
                            {offer.rating && <small className="text-[#716966] text-[11px]">{offer.rating}</small>}
                            <small className="block text-[#716966] text-[11px] mt-1">{offer.sizes?.length ? `Sizes listed: ${offer.sizes.join(', ')}. Confirm stock at store.` : "Sizes: check availability at store"}</small>
                            {!checkingPrices && offer.reason === 'blocked' && <small className="block text-[#716966] text-[11px]">The store requires verification before sharing live details.</small>}
                            {offer.checkedAt && offer.price > 0 && <small className="block text-[#716966] text-[11px]">Price checked {new Date(offer.checkedAt).toLocaleString('en-IN')}</small>}
                          </div>

                          <div className="text-right">
                            <strong className="block text-[15px]">{offer.price > 0 ? money(offer.price) : "Check price"}</strong>
                            <a
                              href={redirect}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => apiPost("/api/click", { product: selected.name, platform: group.platform, seller: offer.seller }).catch(() => {})}
                              className="block bg-[#241d1d] text-white no-underline px-2 py-1.5 text-[11px] mt-1 text-center hover:bg-[#3a2f2f]"
                            >
                              Buy Now
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
            <small className="text-[#716966] text-[11px] mt-4 block">Prices and availability may vary by seller and region.</small>
          </div>
        </section>
      )}
    </main>
  );
}
