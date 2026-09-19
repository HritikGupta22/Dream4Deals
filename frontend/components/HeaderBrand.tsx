"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HeaderBrand() {
  const pathname = usePathname();
  const isInstagramReel = pathname.startsWith("/reel/instagram-");

  function returnFromShop(event: React.MouseEvent<HTMLAnchorElement>) {
    if (pathname !== "/shop") return;

    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (/^\/reel\/instagram-[a-zA-Z0-9_-]+$/.test(returnTo || "")) {
      event.preventDefault();
      window.location.assign(returnTo!);
    }
  }

  if (isInstagramReel) {
    return (
      <a href={pathname} className="shrink-0 text-[23px] font-bold tracking-[-1.5px] no-underline text-inherit">
        dream<span className="text-[#e96050]">4</span>deals
      </a>
    );
  }

  return (
    <Link
      href="/"
      onClick={returnFromShop}
      className="shrink-0 text-[23px] font-bold tracking-[-1.5px] no-underline text-inherit"
    >
      dream<span className="text-[#e96050]">4</span>deals
    </Link>
  );
}
