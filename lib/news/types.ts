export type NewsArticle = {
  brand: string;
  title: string;
  url: string;
  domain: string;
  publishedAt: string; // ISO date
  dedupeHash: string;
};

export type NewsAdapter = {
  key: "gdelt" | "newsapi";
  label: string;
  isConfigured: () => boolean;
  search: (brand: string, sinceDate: Date) => Promise<NewsArticle[]>;
};
