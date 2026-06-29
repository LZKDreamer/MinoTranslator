import {getTranslations} from "next-intl/server";
import type {Locale} from "@/i18n/routing";
import {site} from "@/config/site";

type Props = {
  locale: Locale;
};

export async function SiteFooter({locale}: Props) {
  const t = await getTranslations({locale, namespace: "footer"});

  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="brand">
          <img src="/assets/icon128.png" alt="" />
          <span>{locale === "zh-CN" ? "Mino 翻译" : "Mino Translator"}</span>
        </div>
        <p>{t("note")} · <a href="/privacy/index.html" target="_blank" className="text-link">{t("privacyPolicy")}</a></p>
        <span>{site.domain}</span>
      </div>
    </footer>
  );
}
