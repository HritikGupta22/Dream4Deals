import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { apiFetch } from "@/lib/api";
import type { Reel } from "@/lib/types";
import ReelClient from "./ReelClient";

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const reel = await apiFetch<Reel>(`/api/reels/${slug}`).catch(() => null);
  
  if (!reel) {
    return { title: "Dream4Deals - Fashion Reel Shopping" };
  }

  const title = `${reel.title} | Dream4Deals`;
  const description = reel.caption || `Shop products from ${reel.creator.name}'s Instagram reel on Dream4Deals. Compare prices across Amazon, Flipkart, Myntra, and Meesho.`;
  const image = reel.poster || "/default-reel.jpg";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://dream4deals.com/reel/${slug}`,
      images: [{ url: image, width: 1200, height: 630, alt: reel.title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
    canonical: `https://dream4deals.com/reel/${slug}`,
    robots: { index: true, follow: true },
  };
}

export default async function ReelPage({ params }: Props) {
  const { slug } = await params;
  const reel = await apiFetch<Reel & { error?: string }>(`/api/reels/${slug}`).catch(() => null);
  if (!reel || reel.error) notFound();

  // JSON-LD structured data for Product schema
  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "ItemList",
    "name": reel.title,
    "description": reel.caption,
    "creator": {
      "@type": "Person",
      "name": reel.creator.name,
      "url": `https://instagram.com/${reel.creator.handle}`,
    },
    "itemListElement": reel.products.map((product, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "item": {
        "@type": "Product",
        "name": product.name,
        "description": product.category,
        "image": product.image,
        "offers": {
          "@type": "AggregateOffer",
          "priceCurrency": "INR",
          "lowPrice": String(product.price),
          "highPrice": String(product.price),
        },
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <ReelClient reel={reel} />
    </>
  );
}
