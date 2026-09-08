export interface Creator {
  name: string;
  handle: string;
  followers: string;
  bio?: string;
}

export interface SellerLink {
  platform: string;
  url: string;
  seller?: string;
  price?: number;
  rating?: string;
  delivery?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  sellerLinks?: SellerLink[];
}

export interface Seller {
  seller: string;
  price: number;
  rating: string;
  delivery: string;
  link: string;
}

export interface PlatformOffers {
  platform: string;
  sellers: Seller[];
}

export interface Reel {
  slug: string;
  title: string;
  caption: string;
  poster: string;
  videoUrl?: string;
  instagramMediaId?: string;
  creator: Creator;
  products: Product[];
}

export interface Mapping {
  instagramMediaId: string;
  slug: string;
  title: string;
  url: string;
}

export interface Automation {
  enabled: boolean;
  replyComments: boolean;
  replyDms: boolean;
  triggers: string[];
  replyTemplate: string;
  metaConfigured: boolean;
  mappings: Mapping[];
}

export interface Event {
  type: string;
  detail: string;
}

export interface Dashboard {
  totalReels:  number;
  totalClicks: number;
  topProduct:  string | null;
  topPlatform: string | null;
  estRevenue:  number;
}

export interface Platform {
  id: number;
  name: string;
}

export interface Offer {
  id: number;
  platform: string;
  platform_id: number;
  seller: string;
  price: number;
  delivery: string;
  rating: string;
  link: string;
  available: boolean;
}

export interface AnalyticsRow { label: string; clicks: number; }
export interface Analytics {
  byReel:     AnalyticsRow[];
  byPlatform: AnalyticsRow[];
  byProduct:  AnalyticsRow[];
  daily:      { day: string; clicks: number }[];
}
