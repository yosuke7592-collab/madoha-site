const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelectorAll('main > section, .sample-caution, #report > section').forEach((el) => el.dataset.reveal = '');
if (reduced || !('IntersectionObserver' in window)) {
  document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: .08, rootMargin: '0px 0px -30px' });
  document.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el));
}
