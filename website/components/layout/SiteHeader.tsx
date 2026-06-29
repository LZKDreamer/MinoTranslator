import Link from "next/link";
import {Menu} from "@/components/ui/Icons";
import {getTranslations} from "next-intl/server";
import type {Locale} from "@/i18n/routing";

type Props = {
  locale: Locale;
};

export async function SiteHeader({locale}: Props) {
  const t = await getTranslations({locale, namespace: "nav"});
  const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";

  return (
    <header className="site-header">
      <Link className="brand" href={`/${locale}`} aria-label="Mino Translator">
        <img src="/assets/icon128.png" alt="" />
        <span>{locale === "zh-CN" ? "Mino 翻译" : "Mino Translator"}</span>
      </Link>
      <nav className="nav-links" aria-label="Primary">
        <a href="#features">{t("features")}</a>
        <a href="#install">{t("install")}</a>
        <a href="#faq">{t("faq")}</a>
      </nav>
      <div className="header-actions">
        <Link className="lang-switch" href={`/${nextLocale}`} hrefLang={nextLocale}>
          {t("language")}
        </Link>
        <a className="button button-primary header-download" href="#download">
          {t("download")}
        </a>
        <details className="mobile-menu">
          <summary aria-label={t("menu")}>
            <Menu size={20} strokeWidth={1.75} />
          </summary>
          <div className="mobile-menu-panel">
            <a href="#features">{t("features")}</a>
            <a href="#install">{t("install")}</a>
            <a href="#faq">{t("faq")}</a>
            <Link href={`/${nextLocale}`} hrefLang={nextLocale}>
              {t("language")}
            </Link>
          </div>
        </details>
      </div>
    </header>
  );
}
