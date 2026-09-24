import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card } from 'antd';
const sectionCardStyle = { borderRadius: 12 };
export default function DocsPage() {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);
  const [activeId, setActiveId] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch('/api-docs.generated.html', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.text();
      })
      .then((text) => {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
        setHtml(text.replace(/http:\/\/localhost:3000/g, origin));
        const headings: { id: string; text: string; level: number }[] = [];
        const re = /<h([1-3])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
          headings.push({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
        }
        setToc(headings);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    if (!contentRef.current || toc.length === 0) return;
    const els = contentRef.current.querySelectorAll('h1[id], h2[id], h3[id]');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [html, toc]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
      setActiveId(id);
    }
  };

  if (error)
    return (
      <Alert
        type="error"
        showIcon
        message="接入文档加载失败"
        action={<Button onClick={() => setVersion((v) => v + 1)}>重试</Button>}
      />
    );
  if (loading) {
    return (
      <Card style={sectionCardStyle} loading>
        <div style={{ minHeight: 400 }} />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <Card style={{ ...sectionCardStyle, flex: 1, minWidth: 0 }}>
        <style>{`
          .docs-content { color: #1e293b; line-height: 1.75; }
          .docs-content h1 { font-size: 1.75rem; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; color: #0f172a; }
          .docs-content h2 { font-size: 1.35rem; margin: 28px 0 12px; color: #1e293b; }
          .docs-content h3 { font-size: 1.12rem; margin: 22px 0 8px; color: #334155; }
          .docs-content h4 { font-size: 1rem; margin: 16px 0 6px; color: #475569; }
          .docs-content p { margin: 0 0 12px; }
          .docs-content ul { margin: 0 0 12px; padding-left: 20px; }
          .docs-content ul li { margin-bottom: 4px; }
          .docs-content code { background: #f1f5f9; color: #d9465e; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: 'SF Mono', 'Fira Code', monospace; }
          .docs-content pre { background: #1e293b; color: #e2e8f0; padding: 16px 20px; border-radius: 10px; overflow-x: auto; margin: 0 0 16px; }
          .docs-content pre code { background: none; color: inherit; padding: 0; border-radius: 0; font-size: 0.88em; }
          .docs-content table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 0.92em; }
          .docs-content table th, .docs-content table td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
          .docs-content table th { background: #f8fafc; font-weight: 600; color: #334155; }
          .docs-content table tr:nth-child(even) td { background: #fafbfc; }
          .docs-content hr { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
          .docs-content a { color: #1677ff; }
          .docs-content strong { color: #0f172a; }
          .docs-toc { display: block; }
          @media (max-width: 1100px) { .docs-toc { display: none; } }
        `}</style>
        <div ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />
      </Card>

      {toc.length > 0 && (
        <nav
          className="docs-toc"
          style={{
            position: 'sticky',
            top: 24,
            width: 220,
            flexShrink: 0,
            maxHeight: 'calc(100vh - 48px)',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
            padding: '16px 0'
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#0f172a',
              padding: '0 16px 10px',
              borderBottom: '1px solid #e2e8f0',
              marginBottom: 6
            }}
          >
            目录
          </div>
          {toc.map((item) => (
            <a
              key={item.id}
              onClick={(e) => {
                e.preventDefault();
                scrollTo(item.id);
              }}
              href={`#${item.id}`}
              style={{
                display: 'block',
                padding: `${item.level === 2 ? 5 : item.level === 3 ? 3 : 6}px 16px`,
                paddingLeft: 16 + (item.level - 1) * 14,
                fontSize: item.level === 1 ? 13 : item.level === 2 ? 12 : 11,
                fontWeight: item.level === 1 ? 600 : 400,
                color: activeId === item.id ? '#1677ff' : item.level === 1 ? '#334155' : '#64748b',
                background: activeId === item.id ? '#eef4ff' : 'transparent',
                borderRight: activeId === item.id ? '3px solid #1677ff' : '3px solid transparent',
                textDecoration: 'none',
                lineHeight: 1.5,
                cursor: 'pointer',
                transition: 'all 0.15s',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={item.text}
            >
              {item.text}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
