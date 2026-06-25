"use client";

import {useEffect, useRef, useState} from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
  id?: string;
  as?: "section" | "div" | "article";
};

export function RevealOnScroll({children, className = "", id, as: Tag = "div"}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Check for reduced motion preference
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (mq.matches || entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {threshold: 0.12, rootMargin: "0px 0px -40px 0px"}
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      id={id}
      className={`reveal ${visible ? "reveal-visible" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
