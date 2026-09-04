"use client";

import { useState } from "react";
import Image from "next/image";
import { apiFetch, apiPost, money } from "@/lib/api";
import type { Reel, PlatformOffers, Seller } from "@/lib/types";

export default function ReelClient({ reel }: { reel: Reel }) {
  const [offers, setOffers] = useState<PlatformOffers[]>([]);
  const [selected, setSelected] = useState<{ name: string; image: string } | null>(null);

  async function openComparison(id: string) {
    const product = reel.products.find((p) => p.id === id)!;
    const data = await apiFetch<PlatformOffers[]>(`/api/offers/${id}`);
    setSelected({ name: product.name, image: product.image });
    setOffers(data);
    setTimeout(() => document.getElementById("comparison")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  function lowestKey(platforms: PlatformOffers[]) {
    const all: (Seller & { platform: string })[] = platforms.flatMap((g) =>
      (g.sellers ?? []).map((s) => ({ ...s, platform: g.platform }))
    );
    const lowest = all.sort((a, b) => a.price - b.price)[0];
    return lowest ? `${lowest.platform}|${lowest.seller}|${lowest.price}` : "";
  }

  const best = lowestKey(offers);

  return (
    <main>
      {/* Hero */}
      <section className="grid md:grid-cols-2 min-h-[600px]">
        <div className="relative overflow-hidden bg-[#e8c7c4] min-h-[440px] md:min-h-[600px]">
          <Image
            src={reel.poster || "/placeholder.jpg"}
            alt={reel.title}
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/50" />
          <i className="not-italic absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60px] h-[60px] bg-white/90 rounded-full flex items-center justify-center text-xl pl-1">▶</i>
          <small className="absolute bottom-6 left-7 text-white text-[11px] z-10">◉ Original Reel</small>
        </div>
        <div className="px-[8%] py-[60px] md:px-[13%] md:py-[100px]">
          <div className="border-b border-[#ebdfda] pb-4 mb-11">
            <b className="block text-[13px]">{reel.creator.name}</b>
            <small className="block text-[11px] text-[#716966] mt-1">{reel.creator.handle} · {reel.creator.followers}</small>
          </div>
          <p className="text-[11px] font-bold tracking-[1.5px] text-[#e96050] mb-3">THE EDIT</p>
          <h1 className="font-serif text-[40px] md:text-[53px] leading-[1.08] tracking-[-1.5px] m-0">{reel.title}</h1>
          <p className="text-[#716966] leading-relaxed max-w-[370px] my-6">
            Every piece from this look, all in one place — with the best price shown first.
          </p>
          <a href="#shop" className="inline-block bg-[#241d1d] text-white px-5 py-3.5 text-[13px] font-bold no-underline">
            Shop this reel ↓
          </a>
          <em className="block border-t border-[#ebdfda] mt-11 pt-4 text-[#716966] text-[12px] not-italic">
            &ldquo;{reel.caption}&rdquo;
          </em>
        </div>
      </section>

      {/* Products */}
      <section id="shop" className="px-[7vw] py-[95px]">
        <p className="text-[11px] font-bold tracking-[1.5px] text-[#e96050] mb-3">SHOP THE LOOK</p>
        <h2 className="font-serif text-[40px] tracking-[-1.5px] m-0">Tagged in this reel</h2>
        <p className="text-[#716966] text-[13px] mt-2 mb-8">Tap an item to compare prices and sellers across trusted stores.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {reel.products.map((p) => (
            <article
              key={p.id}
              onClick={() => openComparison(p.id)}
              className="bg-white cursor-pointer transition-transform hover:-translate-y-1"
            >
              <div className="relative h-[315px]">
                <Image src={p.image} alt={p.name} fill className="object-cover" />
              </div>
              <div className="p-4">
                <h3 className="text-[14px] m-0">{p.name}</h3>
                <p className="text-[12px] text-[#716966] my-1.5">{p.category}</p>
                <b className="text-[14px]">from {money(p.price)}</b>
                <span className="float-right text-[#e96050] text-[12px] font-bold">Compare →</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Comparison panel */}
      {selected && (
        <section id="comparison" className="px-[5vw] md:px-[10vw] py-[65px] bg-[#fff0eb] grid md:grid-cols-[290px_1fr] gap-[30px] md:gap-[52px] relative">
          <button
            onClick={() => setSelected(null)}
            className="absolute right-6 top-4 border-0 bg-transparent text-[30px] cursor-pointer"
            aria-label="Close"
          >×</button>
          <div className="relative h-[370px]">
            <Image src={selected.image} alt={selected.name} fill className="object-cover" />
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-[1.5px] text-[#e96050] mb-3">COMPARE PRICES</p>
            <h2 className="font-serif text-[34px] tracking-[-1.5px] mb-4">{selected.name}</h2>
            <p className="text-[13px] bg-white p-3 mb-2">✦ The lowest available offer is highlighted.</p>
            {offers.map((group) => (
              <div key={group.platform} className="mt-5">
                <h3 className="text-[14px] font-bold mb-2">{group.platform}</h3>
                {[...(group.sellers ?? [])].sort((a, b) => a.price - b.price).map((offer) => {
                  const key = `${group.platform}|${offer.seller}|${offer.price}`;
                  const redirect = `/api/redirect?platform=${encodeURIComponent(group.platform)}&product=${encodeURIComponent(selected.name)}&url=${encodeURIComponent(offer.link)}`;
                  return (
                    <div
                      key={key}
                      className={`bg-white p-3 my-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2 ${key === best ? "outline outline-1 outline-[#e8a196]" : ""}`}
                    >
                      <div>
                        <b className="block text-[13px]">{offer.seller}{key === best ? " · Lowest price" : ""}</b>
                        <small className="text-[#716966] text-[11px]">☆ {offer.rating}</small>
                      </div>
                      <small className="text-[#716966] text-[11px]">{offer.delivery}</small>
                      <div className="text-right">
                        <strong className="block text-[15px]">{money(offer.price)}</strong>
                        <a
                          href={`http://localhost:3000${redirect}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => apiPost("/api/click", { product: selected.name, platform: group.platform, seller: offer.seller })}
                          className="block bg-[#241d1d] text-white no-underline px-2 py-1.5 text-[11px] mt-1 text-center"
                        >
                          Buy now
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <small className="text-[#716966] text-[11px] mt-4 block">Prices shown are illustrative until marketplace feeds are connected.</small>
          </div>
        </section>
      )}
    </main>
  );
}
