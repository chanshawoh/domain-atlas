import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { getLocale } from './i18n';

// Adapted from Magic UI (MIT). See public/THIRD-PARTY-NOTICES.txt.
export function NumberTicker({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const current = useMotionValue(0);
  const spring = useSpring(current, { damping: 35, stiffness: 160 });
  const locale = getLocale();
  const formatted = new Intl.NumberFormat(locale).format(value);

  useEffect(() => {
    const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    if (reduced) {
      if (ref.current) ref.current.textContent = format.format(value);
      return;
    }
    const unsubscribe = spring.on('change', next => {
      if (ref.current) ref.current.textContent = format.format(next);
    });
    if (inView) current.set(value);
    return unsubscribe;
  }, [value, locale, inView, reduced, current, spring]);

  return <strong className="number-ticker"><span className="sr-only">{formatted}</span><span ref={ref} aria-hidden="true">{formatted}</span></strong>;
}

// Adapted from React Bits SpotlightCard (MIT + Commons Clause).
// Pointer position uses CSS properties to avoid re-rendering the card's content.
export function SpotlightCard({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return <article className={'spotlight-card ' + (className ?? '')} onPointerMove={event => {
    if (reduced || event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`);
  }}>{children}</article>;
}

// Adapted from Magic UI AnimatedBeam's measured SVG connection (MIT).
// The highlight traces the tree that is already on screen: down the domain spine,
// then into the selected capability. Dropping from the title's centre instead put
// a horizontal run just above the first card, where it read as a second, misaligned
// border. A one-time reveal indicates selection, not an ongoing business data flow.
export function DomainGroup({ children, activeId }: { children: ReactNode; activeId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [beam, setBeam] = useState({ path: '', width: 1, height: 1 });

  useEffect(() => {
    const container = ref.current!;
    const spine = container.querySelector('.capabilities');
    const to = container.querySelector('.capability-card.selected');
    if (!spine || !to) { setBeam({ path: '', width: 1, height: 1 }); return; }
    const update = () => {
      const box = container.getBoundingClientRect();
      const spineBox = spine.getBoundingClientRect();
      const end = to.getBoundingClientRect();
      // The map applies a zoom transform, so layout pixels must be scaled.
      const scale = container.offsetWidth ? box.width / container.offsetWidth : 1;
      // Offsets match the spine rule drawn by `.capabilities::before`.
      const x = spineBox.left - box.left + 7 * scale;
      const y = spineBox.top - box.top + 2 * scale;
      const targetY = end.top - box.top + end.height / 2;
      setBeam({ width: box.width, height: box.height,
        path: `M ${x} ${y} V ${targetY} H ${end.left - box.left}` });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container); observer.observe(spine); observer.observe(to);
    update();
    return () => observer.disconnect();
  }, [activeId, children]);

  return <div ref={ref} className="domain-group">
    {children}
    {beam.path && <svg className="selection-beam" aria-hidden="true" viewBox={`0 0 ${beam.width} ${beam.height}`}>
      <motion.path key={activeId} d={beam.path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: reduced ? 0 : .55, ease: 'easeOut' }} />
    </svg>}
  </div>;
}
