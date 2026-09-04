import type { Metadata } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair" });

export const metadata: Metadata = {
  title: "Dream4Deals | Shop the look",
  description: "Creator-first shopping and price comparison",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${playfair.variable}`}>
      <body className="bg-[#fff9f5] text-[#241d1d] font-sans antialiased">
        <header className="h-[76px] px-[7vw] flex items-center justify-between border-b border-[#ebdfda] bg-[#fffdfb]">
          <a href="/" className="text-[23px] font-bold tracking-[-1.5px] no-underline text-inherit">
            dream<span className="text-[#e96050]">4</span>deals
          </a>
          <nav className="hidden md:flex gap-8">
            <a href="#shop" className="text-[13px] text-[#716966] no-underline">Shop the reel</a>
            <a href="/studio" className="text-[13px] text-[#716966] no-underline">Creator Studio</a>
          </nav>
        </header>
        {children}
        <footer className="bg-[#20191a] text-white px-[7vw] py-8 flex gap-6 items-center">
          <a href="/" className="text-[23px] font-bold tracking-[-1.5px] no-underline text-white">
            dream<span className="text-[#e96050]">4</span>deals
          </a>
          <p className="text-[#b7a9a4] border-l border-[#655957] pl-6 text-[12px] m-0">
            Shop creator looks, smarter.
          </p>
        </footer>
      </body>
    </html>
  );
}
