// The Nayan website at "/" (the app itself is at /app). Static HTML rendered on the server; every effect (scene
// crossfade, ripple lens, koi, reveals, typing, entrance) lives in the client component SiteEffects.
import type { CSSProperties, ReactNode } from "react";
import SiteEffects from "@/components/site/SiteEffects";
import { SPARK_SERIES, areaChart, series, sparkline } from "@/lib/site-charts";
import { APP_PATH, DEMO_PATH } from "@/lib/app-url";

const DATA_URL = "https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india";
const DAY = "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261104_151305_25ef1f45-0886-491c-a7a8-81e296402d5a.png&w=2400&q=85";
const NIGHT = "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261104_151304_3b7ab857-b4c2-4f5a-8d7f-e1ec429185a5.png&w=2400&q=85";
const VIDEO = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261104_160514_d8369d6e-d8ba-4532-9751-b32e0c8aaf75.mp4";

const Hi = ({ children }: { children: ReactNode }) => <span lang="hi">{children}</span>;

const Chev = () => (
  <svg className="chev" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
const Arrow = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const ICONS: Record<string, ReactNode> = {
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  hand: <><path d="M8 13V6.5a1.5 1.5 0 013 0V12" /><path d="M11 11V5a1.5 1.5 0 013 0v6" /><path d="M14 11V6.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6.5 7S5 18.5 4.5 16L3.6 13a1.4 1.4 0 012.5-1.2L8 14" /></>,
  pill: <><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="8" cy="10" r="1.8" /><circle cx="12" cy="10" r="1.8" /><circle cx="16" cy="10" r="1.8" /><circle cx="8" cy="15" r="1.8" /><circle cx="12" cy="15" r="1.8" /><circle cx="16" cy="15" r="1.8" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>,
  heart: <><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /></>,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  check: <><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-6 6.5-6s5.9 2.4 6.5 6" /><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.4c2 .8 3.2 2.8 3.5 5.6" /></>,
  bell: <><path d="M6 16V11a6 6 0 0112 0v5l2 2H4z" /><path d="M10 20a2 2 0 004 0" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
};
const Icon = ({ name, size = "icon" }: { name: string; size?: string }) => (
  <span className={size} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  </span>
);

const Logo = ({ cls = "logo", href = "#top" }: { cls?: string; href?: string }) => (
  <a className={cls} href={href} aria-label="Nayan, top of page">
    <span className="orb" aria-hidden="true" />
    Nayan
  </a>
);

const TextLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="tlink" href={href}>
    {children}
    <Arrow />
  </a>
);

// ---- dashboard data (illustrative demo data) ----
const KPIS = [
  { label: "Strips checked", value: "18", delta: "+6", up: true, color: "#9b8cff" },
  { label: "Matched", value: "14", delta: "+4", up: true, color: "#7cf0bd" },
  { label: "Not sure", value: "3", delta: "−2", up: false, color: "#ffc27a" },
  { label: "Family answers", value: "1", delta: "+1", up: true, color: "#ff8fd8" },
];
const BARS = [
  { label: "Match", v: 62, color: "#7cf0bd" },
  { label: "Not sure", v: 18, color: "#ffc27a" },
  { label: "Strength differs", v: 9, color: "#ff8fd8" },
  { label: "Expired", v: 6, color: "#9b8cff" },
  { label: "Other salt", v: 5, color: "#7fd6ff" },
];
const chart = areaChart();

function Spark({ i, color }: { i: number; color: string }) {
  const [n, seed, base, amp, trend] = SPARK_SERIES[i];
  const s = sparkline(series(n, seed, base, amp, trend));
  const id = `sg${i}`;
  return (
    <svg className="spark" viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="dfill" d={s.area} fill={`url(#${id})`} />
      <path className="dline" d={s.line} pathLength={1} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Dashboard() {
  return (
    <div className="dash reveal" id="dash" role="img" aria-label="Nayan app preview with illustrative demo data: 18 strips checked this week, 14 matched, 3 not sure, 1 family answer, and no wrong matches.">
      <div className="dtop" aria-hidden="true">
        <span className="mlogo"><span className="orb" />Nayan</span>
        <span className="crumb">Checks&nbsp;&nbsp;/&nbsp;&nbsp;<b>Morning medicines</b></span>
        <span className="sp" />
        <span className="search"><Icon name="search" size="si" />Search medicines<kbd>⌘K</kbd></span>
        <span className="chip live">Listening</span>
        <span className="av">AK</span>
      </div>
      <div className="dbody" aria-hidden="true">
        <div className="side">
          <div className="gh">WORKSPACE</div>
          <span className="si-item on"><Icon name="check" size="sic" />Check a strip</span>
          <span className="si-item"><Icon name="sun" size="sic" />Today<em>3</em></span>
          <span className="si-item"><Icon name="list" size="sic" />My medicines<em>3</em></span>
          <span className="si-item"><Icon name="users" size="sic" />Family</span>
          <div className="gh gh2">LIBRARY</div>
          <span className="si-item"><Icon name="hand" size="sic" />Tactile tags<em>8</em></span>
          <span className="si-item"><Icon name="pill" size="sic" />Blister checks</span>
          <span className="si-item"><Icon name="bell" size="sic" />Reminders</span>
          <span className="si-item"><Icon name="clock" size="sic" />History<em>12</em></span>
        </div>
        <div className="dmain">
          <div className="dhead">
            <span className="dtitle">Strip checks</span>
            <span className="chip">Demo data</span>
            <span className="chip up trend">▲ 0 wrong matches</span>
            <span className="sp" />
            <span className="seg"><span>Today</span><span className="on">7D</span><span>30D</span></span>
            <span className="newb">+ New prescription</span>
          </div>
          <div className="kpis">
            {KPIS.map((k, i) => (
              <div className="kpi" key={k.label}>
                <div className="kl">{k.label}</div>
                <div className="kv"><span>{k.value}</span><span className={`chip${k.up ? " up" : ""}`}>{k.delta}</span></div>
                <Spark i={i} color={k.color} />
              </div>
            ))}
          </div>
          <div className="crow">
            <div className="pane">
              <div className="ph"><span>Checks this week</span><span className="legend"><i style={{ background: "#9b8cff" }} />Checked<i style={{ background: "#ff8fd8" }} />Not sure</span></div>
              <svg className="area" viewBox="0 0 600 190" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9b8cff" stopOpacity=".42" /><stop offset="1" stopColor="#9b8cff" stopOpacity="0" /></linearGradient>
                  <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8fd8" stopOpacity=".22" /><stop offset="1" stopColor="#ff8fd8" stopOpacity="0" /></linearGradient>
                </defs>
                {chart.grid.map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="rgba(190,170,255,.08)" vectorEffect="non-scaling-stroke" />)}
                <path className="dfill" d={chart.a.area} fill="url(#ga)" />
                <path className="dfill" d={chart.b.area} fill="url(#gb)" />
                <path className="dline" d={chart.a.line} pathLength={1} fill="none" stroke="#9b8cff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <path className="dline d2" d={chart.b.line} pathLength={1} fill="none" stroke="#ff8fd8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                <g className="dfill">
                  <line x1={chart.marker.x} x2={chart.marker.x} y1="8" y2="190" stroke="rgba(220,210,255,.25)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                  <circle cx={chart.marker.x} cy={chart.marker.y} r="4.5" fill="#1a1150" stroke="#b9adff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </g>
              </svg>
            </div>
            <div className="pane">
              <div className="ph"><span>Verdict mix</span></div>
              <div className="bars">
                {BARS.map((b) => (
                  <div key={b.label}>
                    <div className="bl"><span>{b.label}</span><span className="mono">{b.v}%</span></div>
                    <div className="track"><div className="bfill" style={{ "--w": `${(b.v / 62) * 100}%`, background: `linear-gradient(90deg, ${b.color}, ${b.color}ab)` } as CSSProperties} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="table">
            <div className="tr th"><span>Medicine</span><span>Tag</span><span>Strength</span><span>Confidence</span><span>Verdict</span></div>
            <div className="tr"><b>Dolo 650</b><span>One bump</span><span className="mono">650 mg</span><span className="mono">0.98</span><span><span className="chip live">Match</span></span></div>
            <div className="tr"><span>Pantocid 40</span><span>Two bumps</span><span className="mono">40 mg</span><span className="mono">0.98</span><span><span className="chip live">Match</span></span></div>
            <div className="tr"><span>Calpol 500</span><span>—</span><span className="mono">500 mg</span><span className="mono">0.99</span><span><span className="chip">Strength differs</span></span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CODE_TEXT = `  "brand": "DOLO-650",
  "confidence": 0.98,
  "ingredients": [{
    "salt": "Paracetamol IP",
    "strength": "650 mg"
  }],
  "form": "tablet",
  "expiry": "02/2029",
  "rules": {
    "salt": "agrees",
    "strength": "agrees",
    "form": "agrees",
    "expiry": "valid"
  },
  "verdict": "match"`;

const PACKS = [
  { icon: "shield", eyebrow: "RULE-LOCKED VERDICT", title: "A Match Only When Every Rule Agrees", body: "Salt, strength, form and expiry must all agree with the prescription, each read with high confidence. Otherwise Nayan says no match, or not sure.", cap: "Wrong matches (target)", metric: "0", link: "How it decides", href: "#studio" },
  { icon: "hand", eyebrow: "TACTILE TAGS", title: "Verify Once, Know by Touch", body: "After a verified match Nayan gives a stick-on bump tag and says where to stick it. Every day after, find the strip by touch.", cap: "Tags in the kit", metric: "8", link: "See the tags", href: DEMO_PATH },
  { icon: "pill", eyebrow: "BLISTER CHECK", title: "Stop a Double Dose", body: "Photograph the back of the strip. Nayan counts empty pockets twice and warns if this dose was already taken.", cap: "Counts per check", metric: "2×", link: "Try it", href: DEMO_PATH },
];

const USES: { icon: string; title: string; body: ReactNode; chips: [string, string] }[] = [
  { icon: "layers", title: "Many Medicines", body: "Five strips that feel the same. Each gets its own tactile tag, so the morning dose is picked by touch.", chips: ["Tactile tags", "Hindi reminders"] },
  { icon: "home", title: "Living Alone", body: <>A smudged strip gives “not sure”, never a guess. One tap sends it to family for a <Hi>सही / गलत</Hi> answer.</>, chips: ["Ask family", "Blister check"] },
  { icon: "heart", title: "Family Caregivers", body: "Get a link with the strip photo next to the prescription. Answer from another city in one tap.", chips: ["One-tap answer", "Secure link"] },
  { icon: "eye", title: "Low Vision & Literacy", body: "For people who can see but can't read small print or handwriting. Everything is spoken in Hindi.", chips: ["Hindi voice", "Big buttons"] },
];

const FOOT: { h: string; links: [string, string][] }[] = [
  { h: "PRODUCT", links: [["Check a strip", APP_PATH], ["Tactile tags", "#packs"], ["Blister check", "#packs"], ["Reminders", APP_PATH]] },
  { h: "WHO IT'S FOR", links: [["Many medicines", "#uses"], ["Living alone", "#uses"], ["Family caregivers", "#uses"], ["Low vision", "#uses"]] },
  { h: "HOW IT WORKS", links: [["Safety rules", "#packs"], ["AI reads, rules decide", "#studio"], ["Medicine data", DATA_URL], ["Limitations", "#end"]] },
  { h: "RESOURCES", links: [["Open the app", APP_PATH], ["Try the demo", DEMO_PATH], ["Family link help", "#uses"], ["Contact", "#end"]] },
];

const ext = (href: string) => (href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {});

export default function SitePage() {
  return (
    <>
      <a className="skip" href={APP_PATH}>Skip to the app</a>

      <div className="scene" aria-hidden="true">
        <div className="layer day" id="sc-day" style={{ backgroundImage: `url("${DAY}")` }}>
          <video id="pond" muted loop playsInline preload="auto" crossOrigin="anonymous" data-src={VIDEO} />
          <canvas id="pondfx" />
        </div>
        <div className="layer violet" id="sc-violet" />
        <div className="layer night" id="sc-night" style={{ backgroundImage: `url("${NIGHT}")` }} />
        <canvas className="layer" id="koi" />
      </div>

      <nav className="nav" id="nav" data-in aria-label="Main">
        <Logo />
        <div className="menu">
          <a href="#studio">How it works<Chev /></a>
          <a href="#packs">Features<Chev /></a>
          <a href="#uses">Who it&apos;s for<Chev /></a>
          <a href="#end">Safety</a>
        </div>
        <div className="right">
          <a className="login" href={DEMO_PATH}>Demo</a>
          <a className="pill grey" href="#studio">How it works</a>
          <a className="pill dark" href={APP_PATH}>Open Nayan — it&apos;s free</a>
        </div>
      </nav>

      <main id="top">
        <section className="hero" id="hero" aria-labelledby="hero-h">
          <h1 className="hh" id="hero-h">
            <span className="mask"><span data-in id="hl1">Introducing</span></span>
            <span className="mask"><span data-in id="hl2">Nayan</span></span>
          </h1>
          <p className="hsub" data-in id="hsub">
            Verify once, know by touch<sup lang="hi">नयन</sup>
          </p>
          <div className="hbtns" data-in id="hbtns">
            <a className="btn fill" href={APP_PATH}>Open Nayan — it&apos;s free</a>
            <a className="btn ghost" href={DEMO_PATH}>Try the demo</a>
          </div>
          <button className="scard" type="button" data-in id="scard" aria-label="Scroll down and discover how it works">
            <span aria-hidden="true">Scroll down<br />&amp; discover</span>
            <svg viewBox="0 0 22 22" aria-hidden="true"><path d="M11 3v15M5 12l6 6 6-6" fill="none" stroke="#fff" strokeWidth="1.6" /></svg>
          </button>
        </section>

        <section className="studio" id="studio" aria-labelledby="studio-h">
          <h2 className="h2 reveal" id="studio-h">
            The medicine check that <span className="acc">reads your prescription</span>
            <br />
            and checks every strip against it.
          </h2>
          <p className="lede reveal">Point the phone at a strip. Nayan says in Hindi whether it is the medicine your doctor wrote — and never guesses.</p>
          <div className="brow reveal">
            <a className="btn fill" href={APP_PATH}>Open Nayan — it&apos;s free</a>
            <a className="btn ghost" href={DEMO_PATH}>Try the demo</a>
          </div>
          <dl className="stats reveal">
            <div><dt>253,971</dt><dd>Indian medicines<br />in the lookup</dd></div>
            <div><dt>4 rules</dt><dd>salt, strength, form, expiry<br />must all agree</dd></div>
            <div><dt>387</dt><dd>automated tests<br />guard the rules</dd></div>
            <div><dt>0</dt><dd>wrong &apos;match&apos; verdicts<br />is the target</dd></div>
          </dl>
          <Dashboard />
        </section>

        <section className="packs" id="packs" aria-labelledby="packs-h">
          <div className="split">
            <div className="reveal">
              <h2 className="h2" id="packs-h">
                Read carefully, decide by rules, check the blister, ask family,{" "}
                <span className="acc">know by <span className="serif">touch.</span></span>
              </h2>
              <p className="lede">Gemini only reads the label. Fixed, tested rules decide. Verified strips get a tactile tag, so finding the right medicine every day needs no phone.</p>
              <div className="brow">
                <a className="btn white" href="#uses">Who it&apos;s for</a>
                <a className="btn dk" href={APP_PATH}>Open Nayan</a>
              </div>
            </div>
            <div className="code reveal" aria-hidden="true" id="code">
              <div className="chead"><span>strip_check.json</span><span>AI reads · rules decide</span></div>
              <pre className="cbody" data-text={CODE_TEXT}><span id="typed" /><i className="caret" /></pre>
              <div className="cfoot"><span>verdict match · <Hi>एक बिंदु टैग</Hi></span><span className="dotl">ready</span></div>
            </div>
          </div>
          <div className="cards">
            {PACKS.map((p, i) => (
              <article className={`card glass reveal${i === 0 ? " lead" : ""}`} style={{ transitionDelay: `${i * 0.08}s` }} key={p.title}>
                <div className="ctop"><span className="idx">0{i + 1}</span><Icon name={p.icon} /></div>
                <div className="eyebrow">{p.eyebrow}</div>
                <h3 className="ctitle">{p.title}</h3>
                <p className="cbody2">{p.body}</p>
                <div className="meta">
                  <div><div className="cap">{p.cap}</div><div className="metric">{p.metric}</div></div>
                  <TextLink href={p.href}>{p.link}</TextLink>
                </div>
              </article>
            ))}
          </div>
          <ol className="steps reveal">
            <li><span><b>Photograph the prescription.</b> Nayan reads it back in Hindi; you confirm each medicine.</span></li>
            <li><span><b>Check every strip.</b> Match, no match or not sure — spoken aloud: <Hi>“हाँ, यह सही दवा है।”</Hi></span></li>
            <li><span><b>Stick the tactile tag.</b> Then find the right strip by touch, every day, without the phone.</span></li>
          </ol>
        </section>

        <section className="uses" id="uses" aria-labelledby="uses-h">
          <div className="uhead">
            <h2 className="h2 reveal" id="uses-h">Built for everyone<br />who <span className="serif">manages</span> medicines.</h2>
            <p className="lede reveal">One app, four kinds of users. Voice first, big buttons, Hindi throughout.</p>
          </div>
          <div className="stair">
            {USES.map((u, i) => (
              <article className={`role glass reveal r${i + 1}`} style={{ transitionDelay: `${i * 0.06}s` }} key={u.title}>
                <div className="ctop"><span className="tag">WHO IT&apos;S FOR</span><Icon name={u.icon} /></div>
                <h3 className="rtitle">{u.title}</h3>
                <p className="rbody">{u.body}</p>
                <div className="chips"><span className="chip">{u.chips[0]}</span><span className="chip">{u.chips[1]}</span></div>
                <div className="rlink"><TextLink href={APP_PATH}>Open Nayan</TextLink></div>
              </article>
            ))}
          </div>
        </section>

        <section className="end" id="end" aria-labelledby="end-h">
          <div className="cta glass reveal">
            <h2 className="ctah" id="end-h">Check Your Medicines<br /><span className="serif">Safely</span> Today.</h2>
            <p className="lede">Free to use. Your first strip check takes under a minute.</p>
            <div className="brow">
              <a className="btn fill" href={APP_PATH}>Open Nayan — it&apos;s free</a>
              <a className="btn ghost" href={DEMO_PATH}>Try the demo</a>
            </div>
            <p className="note"><Hi>नयन एक जाँच सहायक है, डॉक्टरी सलाह नहीं</Hi>&nbsp;&nbsp;·&nbsp;&nbsp;Hindi voice&nbsp;&nbsp;·&nbsp;&nbsp;Free</p>
          </div>
          <footer className="foot">
            <div className="fgrid">
              <div className="fbrand">
                <Logo cls="logo flogo" />
                <p>A Hindi, voice-first medicine check for blind and low-vision people — from prescription to the right strip, by touch.</p>
                <span className="chip live">Prototype · B.Tech project</span>
              </div>
              {FOOT.map((c) => (
                <div className="fcol" key={c.h}>
                  <h3>{c.h}</h3>
                  <ul>{c.links.map(([t, h]) => <li key={t}><a href={h} {...ext(h)}>{t}</a></li>)}</ul>
                </div>
              ))}
            </div>
            <div className="legal">
              <span>©2026 Nayan · Medicine data: A-Z Medicine Dataset of India (CC BY-SA 4.0)</span>
              <span className="llinks"><a href="#end">Privacy</a><a href="#end">Not medical advice</a><a href={DATA_URL} {...ext(DATA_URL)}>Data licence</a></span>
            </div>
            <div className="wordmark" aria-hidden="true">Nayan</div>
          </footer>
        </section>
      </main>
      <SiteEffects />
    </>
  );
}
