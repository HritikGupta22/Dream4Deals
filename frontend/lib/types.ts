export interface Creator {
  name: string;
  handle: string;
  followers: string;
  bio?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
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
