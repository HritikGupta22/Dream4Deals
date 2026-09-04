import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { apiFetch } from "@/lib/api";
import type { Reel } from "@/lib/types";
import ReelClient from "./ReelClient";

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const reel = await apiFetch<Reel>(`/api/reels/${slug}`).catch(() => null);
  return { title: reel ? `Dream4Deals | ${reel.title}` : "Dream4Deals" };
}

export default async function ReelPage({ params }: Props) {
  const { slug } = await params;
  const reel = await apiFetch<Reel & { error?: string }>(`/api/reels/${slug}`).catch(() => null);
  if (!reel || reel.error) notFound();
  return <ReelClient reel={reel} />;
}
