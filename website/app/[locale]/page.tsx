import {
  Check,
  ChevronRight,
  KeyRound,
  Languages,
  MousePointerClick,
  PackageOpen,
  ServerCog,
  ShieldCheck,
  Subtitles
} from "@/components/ui/Icons";
import {getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {release} from "@/config/release";
import {site} from "@/config/site";
import {models} from "@/config/models";
import {isLocale, type Locale} from "@/i18n/routing";
import {RevealOnScroll} from "@/components/ui/RevealOnScroll";
import {SiteFooter} from "@/components/layout/SiteFooter";
import {SiteHeader} from "@/components/layout/SiteHeader";

type PageProps = {
  params: Promise<{locale: string}>;
};

type TextItem = {
  title: string;
  body?: string;
  text?: string;
};

type FaqItem = {
  question: string;
  answer: string;
};

const featureIcons = [Subtitles, MousePointerClick, KeyRound, PackageOpen, Languages];
const apiIcons = [KeyRound, ServerCog, ShieldCheck];

export default async function HomePage({params}: PageProps) {
  const {locale: rawLocale} = await params;
  if (!isLocale(rawLocale)) notFound();

  const locale: Locale = rawLocale;
  const t = await getTranslations({locale});
  const heroChecks = t.raw("hero.checks") as TextItem[];
  const features = t.raw("features.items") as TextItem[];
  const installSteps = t.raw("install.steps") as TextItem[];
  const apiPoints = t.raw("api.points") as string[];
  const faqItems = t.raw("faq.items") as FaqItem[];
  const privacyItems = t.raw("privacy.items") as TextItem[];
  const downloadReady = Boolean(release.fileUrl);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer
      }
    }))
  };

  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: site.name,
    applicationCategory: "BrowserApplication",
    operatingSystem: "Chrome",
    description: t("seo.description"),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD"
    }
  };

  return (
    <main className="page">
      <SiteHeader locale={locale} />

      <RevealOnScroll as="section" className="hero">
        <div className="container">
          <h1>{t("hero.title")}</h1>
          <p className="hero-lead">{t("hero.subtitle")}</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#download">
              {t("hero.primaryCta")}
            </a>
            <a className="button button-secondary" href="#install">
              {t("hero.secondaryCta")}
            </a>
          </div>

          <div className="hero-preview surface-product">
            <div className="video-card">
              <img src="/assets/subtitle-panda.png" alt={t("hero.previewAlt")} />
              <div className="floating-popup">
                <img src="/assets/popup-active.png" alt={t("hero.popupAlt")} />
              </div>
            </div>
            <aside className="install-panel">
              <h2>{t("hero.installTitle")}</h2>
              <p>{t("hero.installText")}</p>
              <div className="checklist">
                {heroChecks.map((item, index) => (
                  <div className="check-row" key={item.title}>
                    <span className="check-mark">{index + 1}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.text}</small>
                    </span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section" id="features">
        <div className="container">
          <div className="section-head center">
            <h2>{t("features.title")}</h2>
            <p>{t("features.body")}</p>
          </div>
          <div className="feature-grid reveal-stagger">
            {features.map((item, index) => {
              const Icon = featureIcons[index] ?? Check;
              const className = index === 0 ? "feature-card wide" : "feature-card";
              return (
                <article className={index === 1 ? `${className} violet` : className} key={item.title}>
                  <span className="icon-box">
                    <Icon size={21} strokeWidth={1.75} />
                  </span>
                  <h3>{item.title}</h3>
                  {index === 2 ? (
                    <p>{t.rich("features.items.2.body", {
                      agnesLink: (chunks) => <a href={models.agnes.url} target="_blank" rel="noopener noreferrer" className="text-link">{chunks} ↗</a>,
                      models: () => modelLinks(locale)
                    })}</p>
                  ) : (
                    <p>{item.body}</p>
                  )}
                  {index === 0 ? (
                    <div className="mini-shot">
                      <img src="/assets/subtitle-codex.png" alt={t("features.miniAlt")} />
                    </div>
                  ) : null}
                  {index === 1 ? (
                    <div className="mini-shot">
                      <img src="/assets/popup-translation.png" alt={item.title} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section">
        <div className="container split">
          <div className="copy-block">
            <h2>{t("scenes.youtubeTitle")}</h2>
            <p>{t("scenes.youtubeBody")}</p>
          </div>
          <div className="shot-frame">
            <img src="/assets/subtitle-panda.png" alt={t("scenes.youtubeAlt")} />
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section">
        <div className="container split reverse">
          <div className="shot-frame popup-shot">
            <img src="/assets/popup-active.png" alt={t("scenes.popupAlt")} />
          </div>
          <div className="copy-block">
            <h2>{t("scenes.popupTitle")}</h2>
            <p>{t("scenes.popupBody")}</p>
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section" id="download">
        <div className="container download-panel">
          <div>
            <p className="status-pill">
              <span />
              {t("download.status")}
            </p>
            <h2>{t("download.title")}</h2>
            <p>{t("download.body")}</p>
            <div className="release-grid">
              <ReleaseStat label={t("download.version")} value={release.version} />
              <ReleaseStat label={t("download.format")} value="ZIP" />
              <ReleaseStat label={t("download.published")} value={release.publishedAt || t("download.comingSoon")} />
            </div>
          </div>
          <div className="download-actions">
            {downloadReady ? (
              <a className="button button-primary button-large" href={release.fileUrl} download={release.fileName}>
                {t("nav.download")}
              </a>
            ) : (
              <button className="button button-disabled button-large" type="button" disabled>
                {t("download.notReady")}
              </button>
            )}
            <a className="button button-secondary button-large" href="#install">
              {t("download.installGuide")}
            </a>
            <p className="store-status">
              <span />
              {t("hero.status")}
            </p>
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section" id="install">
        <div className="container">
          <div className="section-head center">
            <h2>{t("install.title")}</h2>
            <p>{t("install.body")}</p>
          </div>
          <div className="steps reveal-stagger">
            {installSteps.map((step, index) => (
              <article className="step-card" key={step.title}>
                <span className="icon-box">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {index < installSteps.length - 1 ? <ChevronRight className="step-arrow" size={18} /> : null}
              </article>
            ))}
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section">
        <div className="container api-panel">
          <div className="copy-block">
            <h2>{t("api.title")}</h2>
            <p>{t.rich("api.body", {
                agnesLink: (chunks) => <a href={models.agnes.url} target="_blank" rel="noopener noreferrer" className="text-link">{chunks} ↗</a>,
                models: () => modelLinks(locale)
              })}</p>
            <div className="api-points">
              {apiPoints.map((point, index) => {
                const Icon = apiIcons[index] ?? ShieldCheck;
                return (
                  <span key={point}>
                    <Icon size={18} strokeWidth={1.75} />
                    {point}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="settings-stack">
            <img src="/assets/settings-model.png" alt={t("api.modelAlt")} />
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section" id="faq">
        <div className="container">
          <div className="section-head center">
            <h2>{t("faq.title")}</h2>
          </div>
          <div className="faq-panel">
            {faqItems.map((item) => (
              <details className="faq-row" key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </RevealOnScroll>

      <RevealOnScroll as="section" className="section privacy-section">
        <div className="container">
          <div className="section-head center">
            <h2>{t("privacy.title")}</h2>
          </div>
          <div className="trust-grid">
            {privacyItems.map((item) => (
              <article className="trust-item" key={item.title}>
                <ShieldCheck size={20} strokeWidth={1.75} />
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </RevealOnScroll>

      <SiteFooter locale={locale} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{__html: JSON.stringify(softwareJsonLd)}}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{__html: JSON.stringify(faqJsonLd)}}
      />
    </main>
  );
}

function ReleaseStat({label, value}: {label: string; value: string}) {
  return (
    <div className="release-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function modelLinks(locale: string) {
  const sep = locale === "zh-CN" ? "、" : ", ";
  return models.supported.map((m, i) => (
    <span key={m.name}>
      {i > 0 && <>{sep}</>}
      <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-link">{m.name} ↗</a>
    </span>
  ));
}
