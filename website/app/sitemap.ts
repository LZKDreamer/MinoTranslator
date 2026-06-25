import type {MetadataRoute} from "next";
import {site} from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["zh-CN", "en"].map((locale) => ({
    url: `${site.url}/${locale}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 1
  }));
}
