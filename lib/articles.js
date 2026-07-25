import { getPublicClient, isSupabaseConfigured } from "./supabase";
import { MOCK_ARTICLES } from "./mockArticles";

// All reads fall back to mock articles when Supabase isn't configured,
// so the site works out of the box.

export async function getPublishedArticles() {
  const supabase = getPublicClient();
  if (!supabase) return MOCK_ARTICLES;
  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false });
  if (error || !data || data.length === 0) return data?.length ? data : MOCK_ARTICLES;
  return data;
}

export async function getFeaturedArticle() {
  const articles = await getPublishedArticles();
  return articles.find((a) => a.featured) || articles[0] || null;
}

export async function getRecentArticles(limit = 6) {
  const articles = await getPublishedArticles();
  const featured = await getFeaturedArticle();
  return articles.filter((a) => a.id !== featured?.id).slice(0, limit);
}

export async function getArticleBySlug(slug) {
  const supabase = getPublicClient();
  if (!supabase) return MOCK_ARTICLES.find((a) => a.slug === slug) || null;
  const { data } = await supabase
    .from("articles")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .single();
  return data || MOCK_ARTICLES.find((a) => a.slug === slug) || null;
}

export function usingMockArticles() {
  return !isSupabaseConfigured();
}

export function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}
