"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

export default function HeaderNavigation() {
  const pathname = usePathname();
  const isInstagramReel = pathname.startsWith("/reel/instagram-");
  const hideCreatorStudio = pathname === "/shop" ||
    (pathname.startsWith("/reel/") && pathname !== "/reel/dress-pink-edit");
  const shopHref = isInstagramReel
    ? `/shop?returnTo=${encodeURIComponent(pathname)}`
    : "/shop";

  return (
    <nav className="flex items-center gap-3 sm:gap-8">
      <Link href={shopHref} className="text-[13px] text-[#716966] no-underline">
        Shop all products
      </Link>
      {!hideCreatorStudio && (
        <Link href="/studio" className="text-[13px] text-[#716966] no-underline">
          Creator Studio
        </Link>
      )}
    </nav>
  );
}
