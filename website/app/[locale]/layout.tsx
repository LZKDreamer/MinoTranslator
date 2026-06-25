import type {Metadata, Viewport} from "next";
import {NextIntlClientProvider} from "next-intl";
import {getMessages, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {site} from "@/config/site";
import {isLocale, locales, type Locale} from "@/i18n/routing";
import "@/styles/globals.css";

type Props = {
  children: React.ReactNode;
  params: Promise<{locale: string}>;
};

export function generateStaticParams() {
  return locales.map((locale) => ({locale}));
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();

  const t = await getTranslations({locale, namespace: "seo"});
  const canonical = `${site.url}/${locale}`;

  return {
    title: t("title"),
    description: t("description"),
    metadataBase: new URL(site.url),
    alternates: {
      canonical,
      languages: {
        "zh-CN": `${site.url}/zh-CN`,
        en: `${site.url}/en`
      }
    },
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      url: canonical,
      siteName: site.name,
      locale,
      type: "website",
      images: [{url: "/assets/icon128.png", width: 128, height: 128, alt: site.name}]
    },
    icons: {
      icon: "/assets/icon128.png",
      apple: "/assets/icon128.png"
    }
  };
}

export default async function LocaleLayout({children, params}: Props) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();

  const messages = await getMessages({locale});

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale as Locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
