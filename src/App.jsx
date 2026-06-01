import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   SM-2 SPACED REPETITION ENGINE
   Real algorithm: interval, easeFactor, repetitions, nextReview
═══════════════════════════════════════════════════════════════ */
const SM2 = {
  // quality: 0=blackout,1=wrong,2=wrong+hint,3=correct+hard,4=correct,5=perfect
  calculate(card, quality) {
    let { interval = 1, easeFactor = 2.5, repetitions = 0 } = card;
    if (quality < 3) {
      repetitions = 0;
      interval = 1;
    } else {
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      repetitions += 1;
    }
    easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    const nextReview = Date.now() + interval * 86400000;
    return { interval, easeFactor, repetitions, nextReview, lastQuality: quality, lastReviewed: Date.now() };
  },
  isDue(card) {
    if (!card.nextReview) return true;
    return Date.now() >= card.nextReview;
  },
  daysUntil(card) {
    if (!card.nextReview || this.isDue(card)) return 0;
    return Math.ceil((card.nextReview - Date.now()) / 86400000);
  },
  qualityLabel(q) {
    return ["Blackout","Wrong","Wrong+Hint","Hard","Good","Perfect"][q];
  }
};

/* ═══════════════════════════════════════════════════════════════
   PERSISTENT STORAGE (localStorage — works in user's own env)
═══════════════════════════════════════════════════════════════ */
const STORE_KEY = "nmdcat_srs_v2";
const loadStore = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
};
const saveStore = (data) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
};

/* ═══════════════════════════════════════════════════════════════
   ACTIVE RECALL ENGINE
   Tracks per-question accuracy, response time, confidence
═══════════════════════════════════════════════════════════════ */
const AR = {
  recordAttempt(store, questionId, correct, responseTimeMs, selfRating) {
    const key = `q_${questionId}`;
    const prev = store.questions?.[key] || { attempts: 0, correct: 0, totalTime: 0, history: [] };
    const updated = {
      attempts: prev.attempts + 1,
      correct: prev.correct + (correct ? 1 : 0),
      totalTime: prev.totalTime + responseTimeMs,
      avgTime: Math.round((prev.totalTime + responseTimeMs) / (prev.attempts + 1)),
      accuracy: Math.round(((prev.correct + (correct ? 1 : 0)) / (prev.attempts + 1)) * 100),
      history: [...(prev.history || []).slice(-9), { correct, time: responseTimeMs, rating: selfRating, ts: Date.now() }],
    };
    return { ...store, questions: { ...(store.questions || {}), [key]: updated } };
  },
  getStats(store, questionId) {
    return store.questions?.[`q_${questionId}`] || null;
  },
  getWeakTopics(store, mcqs) {
    return mcqs
      .map(q => ({ ...q, stats: AR.getStats(store, q.id) }))
      .filter(q => q.stats && q.stats.attempts >= 2)
      .sort((a, b) => a.stats.accuracy - b.stats.accuracy)
      .slice(0, 10);
  }
};

/* ═══════════════════════════════════════════════════════════════
   GLOBAL STYLES
═══════════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Poppins:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { background: #f0f4ff; font-family: 'Nunito', sans-serif; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #c7d2fe; border-radius: 4px; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes bounceIn { 0% { transform:scale(0.7); opacity:0; } 60% { transform:scale(1.1); } 100% { transform:scale(1); opacity:1; } }
  @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
  @keyframes pulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.04); } }
  .fade-up { animation: fadeUp 0.35s ease forwards; }
  .card-hover { transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; }
  .card-hover:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(99,102,241,0.18) !important; }
  .btn-press { transition: transform 0.1s; } .btn-press:active { transform: scale(0.95); }
`;

/* ═══════════════════════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════════════════════ */
const SUBJECTS = [
  { id:"bio", name:"Biology", icon:"🧬", color:"#10b981", grad:"linear-gradient(135deg,#10b981,#059669)", chapters:14, mcqs:1240 },
  { id:"chem", name:"Chemistry", icon:"⚗️", color:"#6366f1", grad:"linear-gradient(135deg,#6366f1,#4f46e5)", chapters:12, mcqs:890 },
  { id:"phy", name:"Physics", icon:"⚡", color:"#f59e0b", grad:"linear-gradient(135deg,#f59e0b,#d97706)", chapters:10, mcqs:720 },
  { id:"eng", name:"English", icon:"📖", color:"#ec4899", grad:"linear-gradient(135deg,#ec4899,#db2777)", chapters:6, mcqs:340 },
  { id:"lr", name:"Logical Reasoning", icon:"🧠", color:"#8b5cf6", grad:"linear-gradient(135deg,#8b5cf6,#7c3aed)", chapters:5, mcqs:280 },
];

const CHAPTERS = {
  bio:["Cell Biology","Biological Molecules","Enzymes","Bioenergetics","Nutrition","Gaseous Exchange","Transport","Coordination & Control","Support & Movement","Reproduction","Growth & Development","Genetics","Evolution","Ecosystem"],
  chem:["Stoichiometry","Atomic Structure","Chemical Bonding","States of Matter","Chemical Equilibrium","Acids & Bases","Solutions","Electrochemistry","Reaction Kinetics","Organic Chemistry","Alkyl Halides","Aldehydes & Ketones"],
  phy:["Measurements","Kinematics","Dynamics","Work & Energy","Circular Motion","Fluid Dynamics","Oscillations","Waves","Thermodynamics","Electrostatics"],
  eng:["Reading Comprehension","Vocabulary","Grammar","Sentence Completion","Analogies","Critical Reasoning"],
  lr:["Number Series","Logical Deduction","Pattern Recognition","Spatial Reasoning","Analytical Reasoning"],
};

const SAMPLE_MCQS = [
  { id:1, subject:"bio", chapter:"Cell Biology", topic:"Cell Membrane", question:"Which model describes the cell membrane as a fluid mosaic of proteins embedded in a phospholipid bilayer?", options:{A:"Davson-Danielli model",B:"Singer-Nicolson model",C:"Watson-Crick model",D:"Fluid bilayer model"}, answer:"B", explanation:"The Fluid Mosaic Model was proposed by Singer and Nicolson in 1972. It describes membrane as a fluid phospholipid bilayer with proteins floating like icebergs.", difficulty:"medium", type:"factual", yield_tag:"discoverer" },
  { id:2, subject:"bio", chapter:"Biological Molecules", topic:"Proteins", question:"Which is the SMALLEST amino acid with only a hydrogen atom as R group?", options:{A:"Alanine",B:"Valine",C:"Glycine",D:"Leucine"}, answer:"C", explanation:"Glycine (Gly, G) is the simplest and smallest amino acid. Its R group is just –H, giving it unique flexibility in protein structure.", difficulty:"easy", type:"factual", yield_tag:"smallest" },
  { id:3, subject:"bio", chapter:"Enzymes", topic:"Enzyme Properties", question:"Enzymes that catalyze the same reaction but have different molecular structures are called:", options:{A:"Coenzymes",B:"Isoenzymes",C:"Apoenzymes",D:"Holoenzymes"}, answer:"B", explanation:"Isoenzymes (isozymes) catalyze identical reactions but differ in amino acid sequence. LDH isoenzymes are classic MDCAT examples.", difficulty:"medium", type:"conceptual", yield_tag:null },
  { id:4, subject:"chem", chapter:"Atomic Structure", topic:"Quantum Numbers", question:"Maximum number of electrons in any subshell is given by:", options:{A:"2n²",B:"2(2l+1)",C:"4l+2",D:"n+l"}, answer:"B", explanation:"Max electrons = 2(2l+1). s(l=0)→2, p(l=1)→6, d(l=2)→10, f(l=3)→14. Remember: each orbital holds 2 electrons.", difficulty:"hard", type:"analytical", yield_tag:null },
  { id:5, subject:"phy", chapter:"Thermodynamics", topic:"Second Law", question:"Which statement is the Kelvin-Planck form of the Second Law of Thermodynamics?", options:{A:"Heat flows spontaneously from cold to hot body",B:"No heat engine can convert all absorbed heat into work in a cycle",C:"Entropy of universe always decreases",D:"Energy cannot be created or destroyed"}, answer:"B", explanation:"Kelvin-Planck: It is impossible to construct a heat engine operating in a cycle whose sole effect is absorption of heat from a source and its complete conversion into work.", difficulty:"medium", type:"conceptual", yield_tag:null },
  { id:6, subject:"bio", chapter:"Cell Biology", topic:"Organelles", question:"The LARGEST organelle in a mature plant cell is:", options:{A:"Nucleus",B:"Mitochondria",C:"Central Vacuole",D:"Chloroplast"}, answer:"C", explanation:"The central vacuole can occupy up to 90% of a mature plant cell's volume. It maintains turgor pressure and stores metabolites.", difficulty:"easy", type:"factual", yield_tag:"largest" },
  { id:7, subject:"bio", chapter:"Bioenergetics", topic:"ATP", question:"Which process produces the MOST ATP per glucose molecule?", options:{A:"Glycolysis",B:"Krebs Cycle",C:"Oxidative Phosphorylation",D:"Fermentation"}, answer:"C", explanation:"Oxidative phosphorylation (electron transport chain) produces ~32-34 ATP per glucose, far more than glycolysis (2 ATP) or Krebs cycle (2 ATP).", difficulty:"medium", type:"comparative", yield_tag:"most_abundant" },
  { id:8, subject:"chem", chapter:"Chemical Equilibrium", topic:"Le Chatelier", question:"When pressure is increased in the reaction N₂ + 3H₂ ⇌ 2NH₃, equilibrium shifts:", options:{A:"Towards reactants",B:"Towards products",C:"No shift occurs",D:"Depends on temperature"}, answer:"B", explanation:"Increasing pressure shifts equilibrium towards fewer moles of gas. Left side: 4 moles, Right side: 2 moles. Equilibrium shifts RIGHT towards NH₃.", difficulty:"medium", type:"application", yield_tag:null },
  { id:9, subject:"bio", chapter:"Genetics", topic:"DNA Replication", question:"Which enzyme synthesizes RNA primers during DNA replication?", options:{A:"DNA Polymerase I",B:"DNA Polymerase III",C:"Primase",D:"Helicase"}, answer:"C", explanation:"Primase is an RNA polymerase that synthesizes short RNA primers needed to start DNA replication. DNA polymerase cannot start chains de novo.", difficulty:"medium", type:"factual", yield_tag:null },
  { id:10, subject:"bio", chapter:"Genetics", topic:"DNA Replication", question:"DNA replication is described as semi-conservative because:", options:{A:"Only half the DNA is replicated",B:"Each new molecule has one original and one new strand",C:"Replication occurs on one strand only",D:"Only coding regions are replicated"}, answer:"B", explanation:"Meselson-Stahl experiment (1958) proved semi-conservative replication. Each daughter DNA molecule retains one parental strand and one newly synthesized strand.", difficulty:"medium", type:"conceptual", yield_tag:"discoverer" },
  { id:11, subject:"bio", chapter:"Bioenergetics", topic:"ETC", question:"The final electron acceptor in the electron transport chain is:", options:{A:"NAD⁺",B:"FAD",C:"Cytochrome c",D:"Oxygen"}, answer:"D", explanation:"Molecular oxygen (O₂) is the terminal electron acceptor in aerobic respiration. It accepts electrons and combines with H⁺ to form water. This is why aerobic respiration requires oxygen.", difficulty:"easy", type:"factual", yield_tag:null },
  { id:12, subject:"chem", chapter:"Acids & Bases", topic:"pH", question:"A buffer solution resists change in pH because it contains:", options:{A:"Strong acid and its salt",B:"Weak acid and its conjugate base",C:"Two strong acids",D:"Pure water"}, answer:"B", explanation:"Buffer = weak acid + conjugate base (or weak base + conjugate acid). The Henderson-Hasselbalch equation: pH = pKa + log([A⁻]/[HA]). Blood pH (7.4) is maintained by bicarbonate buffer.", difficulty:"medium", type:"conceptual", yield_tag:null },
];

const FLASHCARDS = [
  { id:1, subject:"bio", chapter:"Cell Biology", front:"What is the powerhouse of the cell?", back:"Mitochondria — produces ATP via oxidative phosphorylation. Has its own DNA and ribosomes (endosymbiotic origin).", tag:"High Yield" },
  { id:2, subject:"bio", chapter:"Enzymes", front:"Define enzyme active site", back:"Specific region on enzyme where substrate binds. Complementary shape to substrate (Lock & Key / Induced Fit). Changes shape slightly in induced fit model.", tag:"Important" },
  { id:3, subject:"chem", chapter:"Stoichiometry", front:"What is Avogadro's number?", back:"6.022 × 10²³ particles per mole. Used to convert between moles and number of particles.", tag:"Formula" },
  { id:4, subject:"phy", chapter:"Dynamics", front:"State Newton's Second Law", back:"F = ma. Net force equals mass × acceleration. Direction of F = direction of a. Units: Newton = kg·m/s²", tag:"Formula" },
  { id:5, subject:"bio", chapter:"Genetics", front:"What is the Central Dogma of Molecular Biology?", back:"DNA → RNA → Protein. Transcription: DNA→mRNA. Translation: mRNA→protein. Proposed by Francis Crick (1958).", tag:"High Yield" },
  { id:6, subject:"bio", chapter:"Cell Biology", front:"What are the 3 components of the cell theory?", back:"1. All living things are made of cells. 2. Cell is the basic unit of life. 3. All cells arise from pre-existing cells (omnis cellula e cellula).", tag:"High Yield" },
  { id:7, subject:"chem", chapter:"Chemical Equilibrium", front:"State Le Chatelier's Principle", back:"When a system at equilibrium is disturbed, it shifts to oppose the disturbance and restore equilibrium. Applies to concentration, pressure, temperature changes.", tag:"Important" },
  { id:8, subject:"bio", chapter:"Bioenergetics", front:"ATP yield from one glucose in aerobic respiration?", back:"Net ~36-38 ATP total: Glycolysis=2, Pyruvate oxidation=6, Krebs=6, ETC=22-24. Exact number varies by source (32-38 range acceptable in MDCAT).", tag:"High Yield" },
];

const FORMULAS = [
  { subject:"phy", topic:"Kinematics", formula:"v = u + at", desc:"Final velocity" },
  { subject:"phy", topic:"Kinematics", formula:"s = ut + ½at²", desc:"Displacement" },
  { subject:"phy", topic:"Thermodynamics", formula:"η = 1 - T₂/T₁", desc:"Carnot efficiency" },
  { subject:"phy", topic:"Waves", formula:"v = fλ", desc:"Wave speed" },
  { subject:"chem", topic:"Stoichiometry", formula:"PV = nRT", desc:"Ideal gas law" },
  { subject:"chem", topic:"Equilibrium", formula:"Kc = [P]^p/[R]^r", desc:"Equilibrium constant" },
  { subject:"bio", topic:"Bioenergetics", formula:"ΔG = ΔH - TΔS", desc:"Gibbs free energy" },
];

const MNEMONICS = [
  { subject:"bio", topic:"Cell Biology", mnemonic:"My Neuron Eats Gorillas Regularly", full:"Mitosis phases: Metaphase, Nuclear envelope breaks, Equatorial plate, Gap, Reformation" },
  { subject:"bio", topic:"Vitamins", mnemonic:"Fat ADEK — Water B&C", full:"Fat-soluble vitamins: A, D, E, K. Water-soluble: B-complex and C" },
  { subject:"chem", topic:"Reactivity", mnemonic:"Please Send Lions, Cats, Monkeys, Animals, Zoos, Into Hot, Calm, Surroundings, Peaceably", full:"Metal reactivity series: K, Na, Li, Ca, Mg, Al, Zn, Fe, Ni, Cu, Sn, Pb" },
];

const AI_SYSTEM_PROMPT = `You are an expert MDCAT MCQ generator for Pakistani medical students preparing for NMDCAT. Generate high-quality, exam-relevant MCQs.

Return ONLY valid JSON (no markdown, no explanation):
{
  "topic": "detected topic name",
  "mcqs": [
    {
      "id": 1,
      "question": "...",
      "options": {"A":"...","B":"...","C":"...","D":"..."},
      "answer": "A",
      "explanation": "detailed MDCAT-focused explanation",
      "type": "factual|conceptual|application|analytical",
      "difficulty": "easy|medium|hard",
      "yield_tag": null or "smallest|largest|most_abundant|discoverer|first|exception"
    }
  ],
  "yield_facts": [{"fact":"...","category":"smallest|largest|discoverer|first|exception"}],
  "key_points": ["point1","point2","point3"]
}

Rules: 8-12 MCQs, at least 2-3 high-yield superlative questions, 4 options each, detailed explanations, MDCAT-focused.`;

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════ */
const C = {
  bg: "#f0f4ff",
  primary: "#6366f1",
  primaryDark: "#4f46e5",
  grad: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  gradHero: "linear-gradient(135deg,#4f46e5 0%,#6366f1 40%,#8b5cf6 100%)",
  gradGold: "linear-gradient(135deg,#f59e0b,#f97316)",
  gradGreen: "linear-gradient(135deg,#10b981,#059669)",
  gradPink: "linear-gradient(135deg,#ec4899,#db2777)",
  text: "#1e1b4b",
  textSub: "#6b7280",
  border: "rgba(99,102,241,0.12)",
  shadow: "0 4px 24px rgba(99,102,241,0.12)",
  shadowLg: "0 8px 40px rgba(99,102,241,0.18)",
};

const glass = (extra={}) => ({
  background: "rgba(255,255,255,0.85)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.6)",
  borderRadius: 20,
  boxShadow: C.shadow,
  ...extra,
});

/* ═══════════════════════════════════════════════════════════════
   SMALL COMPONENTS
═══════════════════════════════════════════════════════════════ */
function GlassCard({ children, style={}, className="", onClick }) {
  return (
    <div onClick={onClick} className={`fade-up ${className}`}
      style={{ ...glass(), padding:20, marginBottom:16, ...style }}>
      {children}
    </div>
  );
}

function Badge({ label, color="#6366f1", size="sm" }) {
  const p = size==="sm" ? "2px 8px" : "4px 12px";
  const fs = size==="sm" ? 10 : 12;
  return <span style={{ display:"inline-block", padding:p, borderRadius:20, background:`${color}18`, color, fontSize:fs, fontWeight:700, letterSpacing:0.5 }}>{label}</span>;
}

function ProgressBar({ value, color=C.primary, height=8 }) {
  return (
    <div style={{ height, borderRadius:height/2, background:"rgba(99,102,241,0.08)", overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${Math.min(Math.max(value,0),100)}%`, background:color, borderRadius:height/2, transition:"width 0.8s ease" }} />
    </div>
  );
}

function XPBar({ xp, maxXp=100, level }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.2)", borderRadius:20, padding:"6px 14px", display:"flex", alignItems:"center", gap:10 }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:C.gradGold, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:"#fff", flexShrink:0 }}>{level}</div>
      <div style={{ flex:1 }}>
        <div style={{ height:6, borderRadius:3, background:"rgba(255,255,255,0.3)", overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${((xp%100)/100)*100}%`, background:C.gradGold, borderRadius:3, transition:"width 1s" }} />
        </div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.8)", marginTop:2 }}>{xp%100}/100 XP to Level {level+1}</div>
      </div>
    </div>
  );
}

function QuickActionBtn({ icon, label, grad, onClick, soon=false }) {
  return (
    <button onClick={onClick} className="btn-press card-hover" style={{ background:soon?"rgba(99,102,241,0.06)":grad||C.grad, border:soon?"1.5px dashed rgba(99,102,241,0.2)":"none", borderRadius:16, padding:"14px 8px", color:soon?"#9ca3af":"#fff", cursor:soon?"default":"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
      <div style={{ fontSize:26 }}>{icon}</div>
      <div style={{ fontSize:10, fontWeight:700, lineHeight:1.2, letterSpacing:0.2 }}>{label}</div>
      {soon && <div style={{ fontSize:8, color:"#d1d5db", background:"rgba(0,0,0,0.08)", padding:"1px 6px", borderRadius:4 }}>SOON</div>}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BOTTOM NAV
═══════════════════════════════════════════════════════════════ */
function BottomNav({ page, setPage }) {
  const tabs = [
    { id:"home", icon:"🏠", label:"Home" },
    { id:"tests", icon:"📋", label:"Tests" },
    { id:"ai", icon:"🤖", label:"AI Tutor" },
    { id:"analytics", icon:"📊", label:"Progress" },
    { id:"settings", icon:"⚙️", label:"Settings" },
  ];
  return (
    <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"rgba(255,255,255,0.95)", backdropFilter:"blur(20px)", borderTop:"1px solid rgba(99,102,241,0.1)", display:"flex", zIndex:200, paddingBottom:"env(safe-area-inset-bottom,8px)" }}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>setPage(t.id)} style={{ flex:1, padding:"10px 4px 8px", border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
          <div style={{ fontSize:20, filter:page===t.id?"none":"grayscale(0.5)", transform:page===t.id?"scale(1.15)":"scale(1)", transition:"all 0.2s" }}>{t.icon}</div>
          <div style={{ fontSize:9, fontWeight:700, color:page===t.id?C.primary:"#9ca3af", letterSpacing:0.3 }}>{t.label}</div>
          {page===t.id && <div style={{ width:4, height:4, borderRadius:"50%", background:C.primary }} />}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SRS FLASHCARD ENGINE — Real SM-2
═══════════════════════════════════════════════════════════════ */
function FlashcardsPage({ store, setStore, addXP }) {
  const [selSub, setSelSub] = useState("all");
  const [mode, setMode] = useState("due"); // "due" | "all" | "stats"
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("question"); // question → answer → rate
  const [startTime, setStartTime] = useState(null);

  const allCards = selSub==="all" ? FLASHCARDS : FLASHCARDS.filter(f=>f.subject===selSub);
  const srsCards = allCards.map(c => ({ ...c, srs: store.flashcards?.[`fc_${c.id}`] || {} }));
  const dueCards = srsCards.filter(c => SM2.isDue(c.srs));
  const displayCards = mode==="due" ? dueCards : srsCards;
  const card = displayCards[idx];

  useEffect(() => { setIdx(0); setPhase("question"); }, [selSub, mode]);
  useEffect(() => { if(phase==="question") setStartTime(Date.now()); }, [phase, idx]);

  const rate = (quality) => {
    const responseTime = Date.now() - (startTime || Date.now());
    const updated = SM2.calculate(card.srs, quality);
    const newStore = {
      ...store,
      flashcards: { ...(store.flashcards||{}), [`fc_${card.id}`]: updated }
    };
    setStore(newStore);
    saveStore(newStore);
    if(quality >= 4) addXP(5);
    else if(quality === 3) addXP(2);

    if(idx < displayCards.length - 1) {
      setIdx(i=>i+1);
      setPhase("question");
    } else {
      setPhase("done");
    }
  };

  const srsInfo = card?.srs;
  const totalDue = srsCards.filter(c=>SM2.isDue(c.srs)).length;

  if(phase==="done") return (
    <div style={{ padding:"20px 16px 80px" }}>
      <GlassCard style={{ textAlign:"center", padding:36 }}>
        <div style={{ fontSize:56, marginBottom:12 }}>🎉</div>
        <div style={{ fontSize:20, fontWeight:900, color:C.text, fontFamily:"Poppins" }}>Session Complete!</div>
        <div style={{ fontSize:13, color:C.textSub, marginTop:4, marginBottom:20 }}>All {displayCards.length} cards reviewed</div>
        <button onClick={()=>{setIdx(0);setPhase("question");setMode("due");}} style={{ padding:"12px 28px", borderRadius:12, border:"none", background:C.grad, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Back to Due Cards</button>
      </GlassCard>
    </div>
  );

  return (
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginBottom:4 }}>🃏 Flashcards</div>

      {/* SRS Status Bar */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
        {[
          { label:"Due Now", val:totalDue, color:"#ef4444", icon:"🔴" },
          { label:"Learned", val:srsCards.filter(c=>c.srs.repetitions>0).length, color:"#10b981", icon:"✅" },
          { label:"New", val:srsCards.filter(c=>!c.srs.repetitions).length, color:C.primary, icon:"🆕" },
        ].map((s,i)=>(
          <div key={i} style={{ ...glass({ padding:"10px 8px", textAlign:"center", borderRadius:14 }) }}>
            <div style={{ fontSize:16 }}>{s.icon}</div>
            <div style={{ fontSize:18, fontWeight:900, color:s.color, fontFamily:"Poppins" }}>{s.val}</div>
            <div style={{ fontSize:9, color:C.textSub, fontWeight:700 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Mode & Subject Filters */}
      <div style={{ display:"flex", gap:8, marginBottom:10, overflowX:"auto", paddingBottom:4 }}>
        {[{id:"due",label:`Due (${totalDue})`},{id:"all",label:"All Cards"}].map(m=>(
          <button key={m.id} onClick={()=>{setMode(m.id);setIdx(0);setPhase("question");}} style={{ padding:"7px 14px", borderRadius:20, border:"none", background:mode===m.id?C.grad:"rgba(255,255,255,0.8)", color:mode===m.id?"#fff":C.textSub, fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>{m.label}</button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:14, overflowX:"auto", paddingBottom:4 }}>
        {[{id:"all",name:"All",icon:"🎯",grad:C.grad},...SUBJECTS].map(s=>(
          <button key={s.id} onClick={()=>{setSelSub(s.id);setIdx(0);setPhase("question");}} style={{ padding:"6px 12px", borderRadius:20, border:"none", background:selSub===s.id?s.grad||C.grad:"rgba(255,255,255,0.8)", color:selSub===s.id?"#fff":C.textSub, fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>{s.icon} {s.name}</button>
        ))}
      </div>

      {!card ? (
        <GlassCard style={{ textAlign:"center", padding:32 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>✅</div>
          <div style={{ fontSize:16, fontWeight:800, color:C.text }}>No cards due!</div>
          <div style={{ fontSize:12, color:C.textSub, marginTop:4, marginBottom:14 }}>Switch to "All Cards" to review anyway</div>
          <button onClick={()=>{setMode("all");setIdx(0);setPhase("question");}} style={{ padding:"10px 20px", borderRadius:12, border:"none", background:C.grad, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Study All</button>
        </GlassCard>
      ) : (
        <>
          {/* Progress */}
          <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8 }}>{idx+1} / {displayCards.length} cards</div>
          <ProgressBar value={(idx/displayCards.length)*100} color={C.primary} height={5} />

          {/* SRS info strip */}
          {srsInfo?.repetitions > 0 && (
            <div style={{ display:"flex", gap:8, marginTop:8, marginBottom:4, flexWrap:"wrap" }}>
              <Badge label={`Interval: ${srsInfo.interval}d`} color="#8b5cf6" />
              <Badge label={`Ease: ${srsInfo.easeFactor?.toFixed(1)}`} color="#06b6d4" />
              <Badge label={`Reps: ${srsInfo.repetitions}`} color="#10b981" />
            </div>
          )}

          {/* Card */}
          <div style={{ marginTop:10, marginBottom:14 }}>
            {/* QUESTION PHASE */}
            {phase === "question" && (
              <div style={{ background:C.gradHero, borderRadius:24, padding:28, minHeight:200, display:"flex", flexDirection:"column", justifyContent:"center", boxShadow:C.shadowLg }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", letterSpacing:2, marginBottom:14 }}>
                  {card.subject?.toUpperCase()} · {card.chapter?.toUpperCase()}
                </div>
                <div style={{ fontSize:18, color:"#fff", fontWeight:700, lineHeight:1.5, marginBottom:16 }}>{card.front}</div>
                {card.tag && <Badge label={card.tag} color="#fbbf24" size="md" />}
                <button onClick={()=>setPhase("answer")} style={{ marginTop:20, padding:"12px", borderRadius:14, border:"none", background:"rgba(255,255,255,0.25)", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", backdropFilter:"blur(4px)" }}>
                  Reveal Answer →
                </button>
              </div>
            )}

            {/* ANSWER PHASE */}
            {phase === "answer" && (
              <>
                <div style={{ background:C.gradGreen, borderRadius:24, padding:28, minHeight:180, display:"flex", flexDirection:"column", justifyContent:"center", boxShadow:C.shadowLg, marginBottom:12 }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", letterSpacing:2, marginBottom:12 }}>ANSWER</div>
                  <div style={{ fontSize:15, color:"#fff", lineHeight:1.6 }}>{card.back}</div>
                </div>

                {/* Active recall self-rating — THE KEY PART */}
                <div style={{ ...glass({ padding:"16px", borderRadius:20 }) }}>
                  <div style={{ fontSize:12, fontWeight:800, color:C.text, marginBottom:4 }}>How well did you know this?</div>
                  <div style={{ fontSize:11, color:C.textSub, marginBottom:12 }}>Be honest — this determines when you'll see it next</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {[
                      { q:0, label:"Blackout", sub:"Had no idea", color:"#ef4444", icon:"💀" },
                      { q:1, label:"Wrong", sub:"Got it wrong", color:"#f97316", icon:"❌" },
                      { q:2, label:"Hint needed", sub:"Almost got it", color:"#f59e0b", icon:"😓" },
                      { q:3, label:"Hard", sub:"Correct, struggled", color:"#84cc16", icon:"😅" },
                      { q:4, label:"Good", sub:"Correct, hesitated", color:"#10b981", icon:"👍" },
                      { q:5, label:"Perfect", sub:"Instant recall", color:"#6366f1", icon:"⭐" },
                    ].map(({q,label,sub,color,icon})=>(
                      <button key={q} onClick={()=>rate(q)} style={{ padding:"10px 12px", borderRadius:14, border:`2px solid ${color}30`, background:`${color}10`, color, cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:18 }}>{icon}</span>
                        <div>
                          <div style={{ fontSize:12, fontWeight:800 }}>{label}</div>
                          <div style={{ fontSize:9, opacity:0.8 }}>{sub} · {SM2.calculate({...card.srs},q).interval}d</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize:10, color:C.textSub, marginTop:10, textAlign:"center" }}>Next review shown below each rating</div>
                </div>
              </>
            )}
          </div>

          {/* Dots nav */}
          <div style={{ display:"flex", justifyContent:"center", gap:5 }}>
            {displayCards.map((_,i)=>(
              <div key={i} onClick={()=>{setIdx(i);setPhase("question");}} style={{ width:i===idx?20:7, height:7, borderRadius:4, background:i===idx?C.primary:SM2.isDue(displayCards[i]?.srs||{})?"#ef444430":"rgba(99,102,241,0.2)", cursor:"pointer", transition:"all 0.3s" }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ACTIVE RECALL — LEARNING MODE
   Forces answer commitment → self-rating → updates AR store
═══════════════════════════════════════════════════════════════ */
function LearningMode({ store, setStore, addXP }) {
  const [step, setStep] = useState("subject");
  const [selSub, setSelSub] = useState(null);
  const [selCh, setSelCh] = useState(null);
  const [qi, setQi] = useState(0);
  const [phase, setPhase] = useState("attempt"); // attempt → check → rate
  const [selected, setSelected] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [sessionStats, setSessionStats] = useState({ correct:0, total:0 });

  const qs = SAMPLE_MCQS.filter(q => !selSub || q.subject===selSub);
  const q = qs[qi];

  useEffect(() => { setStartTime(Date.now()); }, [qi]);

  const checkAnswer = () => {
    if(!selected) return;
    setPhase("check");
  };

  const submitRating = (selfRating) => {
    // selfRating: 0-5 same as SM2 scale
    const correct = selected === q.answer;
    const responseTime = Date.now() - (startTime || Date.now());

    // Update active recall store
    let newStore = AR.recordAttempt(store, q.id, correct, responseTime, selfRating);
    setStore(newStore);
    saveStore(newStore);

    setSessionStats(s => ({ correct: s.correct+(correct?1:0), total:s.total+1 }));

    if(correct && selfRating >= 4) addXP(8);
    else if(correct) addXP(4);

    setPhase("attempt");
    setSelected(null);
    setQi(i => i+1);
  };

  if(step==="subject") return (
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginBottom:4 }}>📚 Learning Mode</div>
      <div style={{ fontSize:13, color:C.textSub, marginBottom:16 }}>Active recall — commit before revealing</div>

      {sessionStats.total > 0 && (
        <div style={{ background:C.grad, borderRadius:16, padding:"12px 16px", marginBottom:14, display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ fontSize:14, fontWeight:800, color:"#fff" }}>Session: {sessionStats.correct}/{sessionStats.total} correct</div>
          <Badge label={`${Math.round(sessionStats.correct/sessionStats.total*100)}%`} color="#fff" />
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {SUBJECTS.map(s => {
          const subQs = SAMPLE_MCQS.filter(q=>q.subject===s.id);
          const attempted = subQs.filter(q=>AR.getStats(store,q.id)).length;
          return (
            <div key={s.id} onClick={()=>{setSelSub(s.id);setStep("chapter");}} className="card-hover" style={{ display:"flex", alignItems:"center", gap:14, padding:"16px 18px", borderRadius:20, background:"rgba(255,255,255,0.85)", border:`2px solid ${s.color}20`, cursor:"pointer", boxShadow:C.shadow }}>
              <div style={{ width:52, height:52, borderRadius:16, background:s.grad, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{s.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:800, color:C.text }}>{s.name}</div>
                <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>{attempted}/{subQs.length} attempted</div>
                <ProgressBar value={subQs.length>0?attempted/subQs.length*100:0} color={s.color} height={5} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if(step==="chapter") {
    const sub = SUBJECTS.find(s=>s.id===selSub);
    return (
      <div style={{ padding:"20px 16px 80px" }}>
        <button onClick={()=>setStep("subject")} style={{ background:"none", border:"none", color:C.primary, fontSize:13, fontWeight:700, cursor:"pointer", marginBottom:12, padding:0 }}>← Back</button>
        <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginBottom:16 }}>{sub?.icon} {sub?.name}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {(CHAPTERS[selSub]||[]).map((ch,i) => {
            const chQs = SAMPLE_MCQS.filter(q=>q.subject===selSub && q.chapter===ch);
            const chAttempted = chQs.filter(q=>AR.getStats(store,q.id)).length;
            return (
              <div key={i} onClick={()=>{setSelCh(ch);setStep("mcq");setQi(0);setPhase("attempt");setSelected(null);}} className="card-hover" style={{ ...glass({ padding:"14px", borderRadius:16, cursor:"pointer" }) }}>
                <div style={{ fontSize:10, color:C.textSub, marginBottom:4 }}>Ch. {i+1}</div>
                <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:6 }}>{ch}</div>
                {chQs.length > 0 ? (
                  <>
                    <ProgressBar value={chAttempted/chQs.length*100} color={sub?.color} height={4} />
                    <div style={{ fontSize:9, color:C.textSub, marginTop:3 }}>{chAttempted}/{chQs.length} done</div>
                  </>
                ) : (
                  <div style={{ fontSize:10, color:C.textSub }}>Add via AI Generator</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if(!q) return (
    <div style={{ padding:"20px 16px 80px" }}>
      <button onClick={()=>setStep("chapter")} style={{ background:"none",border:"none",color:C.primary,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:12,padding:0 }}>← Back</button>
      <GlassCard style={{ textAlign:"center", padding:40 }}>
        <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
        <div style={{ fontSize:18, fontWeight:800, color:C.text }}>Chapter complete!</div>
        <div style={{ fontSize:13, color:C.textSub, marginTop:4 }}>{sessionStats.correct}/{sessionStats.total} correct this session</div>
      </GlassCard>
    </div>
  );

  const qStats = AR.getStats(store, q.id);
  const bd = { easy:{bg:"#d1fae5",c:"#065f46"}, medium:{bg:"#fef3c7",c:"#92400e"}, hard:{bg:"#fee2e2",c:"#991b1b"} }[q.difficulty]||{bg:"#f3f4f6",c:"#374151"};
  const isCorrect = selected === q.answer;

  return (
    <div style={{ padding:"16px 16px 80px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <button onClick={()=>setStep("chapter")} style={{ background:"none",border:"none",color:C.primary,fontSize:13,fontWeight:700,cursor:"pointer",padding:0 }}>← {selCh}</button>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:12, color:C.textSub, fontWeight:600 }}>{qi+1}/{qs.length}</span>
      </div>
      <ProgressBar value={(qi/qs.length)*100} color={C.primary} height={5} />

      {/* Per-question accuracy from active recall history */}
      {qStats && (
        <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
          <Badge label={`${qStats.accuracy}% accuracy`} color={qStats.accuracy>=70?"#10b981":qStats.accuracy>=40?"#f59e0b":"#ef4444"} />
          <Badge label={`${qStats.attempts} attempts`} color={C.primary} />
          <Badge label={`~${Math.round(qStats.avgTime/1000)}s avg`} color="#8b5cf6" />
        </div>
      )}

      <GlassCard style={{ marginTop:12, borderTop:`4px solid ${C.primary}` }}>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
          <Badge label={q.type?.toUpperCase()} color={C.primary} />
          <span style={{ padding:"2px 8px", borderRadius:20, background:bd.bg, color:bd.c, fontSize:10, fontWeight:700 }}>{q.difficulty?.toUpperCase()}</span>
          {q.yield_tag && <Badge label={`⚡ ${q.yield_tag}`} color="#f59e0b" />}
        </div>
        <div style={{ fontSize:15, fontWeight:700, color:C.text, lineHeight:1.6, marginBottom:16 }}>{q.question}</div>

        {/* ATTEMPT PHASE: must pick before seeing answer */}
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
          {Object.entries(q.options).map(([k,v])=>{
            let bg="rgba(255,255,255,0.7)", border=`1.5px solid rgba(99,102,241,0.12)`, col=C.text;
            if(phase==="check" || phase==="rate") {
              if(k===q.answer){bg="#d1fae5";border="2px solid #10b981";col="#065f46";}
              else if(k===selected&&!isCorrect){bg="#fee2e2";border="2px solid #ef4444";col="#991b1b";}
            } else if(k===selected){bg="#eff6ff";border=`2px solid ${C.primary}`;col=C.primaryDark;}
            return (
              <div key={k} onClick={()=>{ if(phase==="attempt") setSelected(k); }}
                style={{ padding:"13px 16px", borderRadius:14, border, background:bg, color:col, cursor:phase==="attempt"?"pointer":"default", display:"flex", gap:10, alignItems:"center", transition:"all 0.15s" }}>
                <span style={{ fontWeight:800, minWidth:20, fontSize:13 }}>{k}.</span>
                <span style={{ fontSize:13, lineHeight:1.4 }}>{v}</span>
                {(phase==="check"||phase==="rate")&&k===q.answer&&<span style={{ marginLeft:"auto" }}>✅</span>}
                {(phase==="check"||phase==="rate")&&k===selected&&!isCorrect&&<span style={{ marginLeft:"auto" }}>❌</span>}
              </div>
            );
          })}
        </div>

        {/* ATTEMPT phase: must pick to continue */}
        {phase==="attempt" && (
          <button onClick={checkAnswer} disabled={!selected}
            style={{ width:"100%", padding:13, borderRadius:12, border:"none", background:selected?C.grad:"rgba(99,102,241,0.3)", color:"#fff", fontSize:13, fontWeight:700, cursor:selected?"pointer":"not-allowed" }}>
            {selected ? "Check Answer →" : "Select an answer first"}
          </button>
        )}

        {/* CHECK phase: shows result + explanation */}
        {phase==="check" && (
          <>
            <div style={{ background:isCorrect?"linear-gradient(135deg,#f0fdf4,#dcfce7)":"linear-gradient(135deg,#fef2f2,#fee2e2)", border:`1px solid ${isCorrect?"#bbf7d0":"#fecaca"}`, borderRadius:14, padding:14, marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:800, color:isCorrect?"#065f46":"#991b1b", marginBottom:6 }}>
                {isCorrect ? "✅ Correct!" : `❌ Incorrect — Answer was ${q.answer}`}
              </div>
              <div style={{ fontSize:12, color:"#374151", lineHeight:1.6 }}>{q.explanation}</div>
            </div>

            {/* Active recall self-rating */}
            <div style={{ background:"#f8faff", borderRadius:14, padding:14, border:"1px solid rgba(99,102,241,0.12)" }}>
              <div style={{ fontSize:12, fontWeight:800, color:C.text, marginBottom:2 }}>Rate your confidence</div>
              <div style={{ fontSize:10, color:C.textSub, marginBottom:10 }}>Honest rating improves your study schedule</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
                {[
                  {q:0,label:"Blackout",color:"#ef4444",icon:"💀"},
                  {q:1,label:"Wrong",color:"#f97316",icon:"❌"},
                  {q:2,label:"Almost",color:"#f59e0b",icon:"😓"},
                  {q:3,label:"Hard",color:"#84cc16",icon:"😅"},
                  {q:4,label:"Good",color:"#10b981",icon:"👍"},
                  {q:5,label:"Easy",color:"#6366f1",icon:"⭐"},
                ].map(({q:qual,label,color,icon})=>(
                  <button key={qual} onClick={()=>submitRating(qual)}
                    style={{ padding:"8px 6px", borderRadius:12, border:`1.5px solid ${color}40`, background:`${color}12`, color, cursor:"pointer", fontSize:11, fontWeight:700, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <span style={{ fontSize:16 }}>{icon}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HOME / DASHBOARD
═══════════════════════════════════════════════════════════════ */
function HomePage({ setPage, setSubPage, store, xp, streak, userName="Mehran" }) {
  const examDate = new Date("2025-09-14");
  const daysLeft = Math.max(0,Math.ceil((examDate-new Date())/86400000));

  const totalAttempts = Object.values(store.questions||{}).reduce((s,q)=>s+q.attempts,0);
  const totalCorrect = Object.values(store.questions||{}).reduce((s,q)=>s+q.correct,0);
  const overallAcc = totalAttempts>0 ? Math.round(totalCorrect/totalAttempts*100) : 0;
  const dueCards = FLASHCARDS.filter(c=>SM2.isDue(store.flashcards?.[`fc_${c.id}`]||{})).length;
  const weakTopics = AR.getWeakTopics(store, SAMPLE_MCQS);

  return (
    <div style={{ paddingBottom:80 }}>
      {/* Hero */}
      <div style={{ background:C.gradHero, borderRadius:"0 0 32px 32px", padding:"20px 20px 28px", position:"relative", overflow:"hidden", marginBottom:20 }}>
        <div style={{ position:"absolute", top:-40, right:-40, width:180, height:180, borderRadius:"50%", background:"rgba(255,255,255,0.06)" }} />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🩺</div>
            <div>
              <div style={{ fontSize:16, fontWeight:900, color:"#fff", fontFamily:"Poppins" }}>NMDCAT Quiz</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.65)", fontWeight:600, letterSpacing:1 }}>BY MEHRAN</div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
          <div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", fontWeight:600 }}>Good morning 🌤️</div>
            <div style={{ fontSize:24, fontWeight:900, color:"#fff", lineHeight:1.2, fontFamily:"Poppins" }}>Hello, {userName}! 👋</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ background:"rgba(255,255,255,0.18)", borderRadius:12, padding:"8px 12px", textAlign:"center" }}>
              <div style={{ fontSize:20, fontWeight:900, color:"#fff" }}>{daysLeft}</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.75)" }}>days left</div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.18)", borderRadius:12, padding:"8px 12px", textAlign:"center" }}>
              <div style={{ fontSize:16 }}>🔥</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.75)" }}>{streak} streak</div>
            </div>
          </div>
        </div>
        <XPBar xp={xp} level={Math.floor(xp/100)+1} />
      </div>

      <div style={{ padding:"0 16px" }}>
        {/* SRS Due Alert */}
        {dueCards > 0 && (
          <div onClick={()=>setSubPage("flashcards")} className="card-hover" style={{ background:"linear-gradient(135deg,#8b5cf6,#6366f1)", borderRadius:16, padding:"14px 18px", marginBottom:14, cursor:"pointer", display:"flex", alignItems:"center", gap:12, boxShadow:"0 6px 20px rgba(139,92,246,0.3)" }}>
            <div style={{ fontSize:28 }}>🃏</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:800, color:"#fff" }}>{dueCards} flashcard{dueCards!==1?"s":""} due for review</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.8)" }}>Tap to start SRS session</div>
            </div>
            <div style={{ fontSize:20, color:"rgba(255,255,255,0.6)" }}>›</div>
          </div>
        )}

        {/* Daily Challenge */}
        <div onClick={()=>setSubPage("daily")} className="card-hover" style={{ background:"linear-gradient(135deg,#f97316,#ef4444)", borderRadius:20, padding:"16px 20px", marginBottom:16, cursor:"pointer", position:"relative", overflow:"hidden", boxShadow:"0 6px 24px rgba(239,68,68,0.3)" }}>
          <div style={{ position:"absolute", right:-20, top:-20, fontSize:80, opacity:0.12 }}>🎯</div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.8)", fontWeight:700, letterSpacing:1, marginBottom:4 }}>🔥 DAILY CHALLENGE</div>
              <div style={{ fontSize:17, fontWeight:800, color:"#fff" }}>10 MCQs · 15 min · All Subjects</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.8)", marginTop:4 }}>+50 XP on completion</div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.25)", borderRadius:12, width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>▶️</div>
          </div>
        </div>

        {/* Real stats from AR store */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
          {[
            { icon:"📝", val:totalAttempts.toLocaleString(), label:"MCQs Done", c:"#6366f1" },
            { icon:"🎯", val:totalAttempts>0?`${overallAcc}%`:"–", label:"Real Accuracy", c:"#10b981" },
            { icon:"🃏", val:dueCards, label:"Cards Due", c:"#8b5cf6" },
          ].map((s,i)=>(
            <div key={i} style={{ ...glass({ padding:"14px 12px", textAlign:"center", borderRadius:16 }) }}>
              <div style={{ fontSize:22 }}>{s.icon}</div>
              <div style={{ fontSize:16, fontWeight:900, color:s.c, fontFamily:"Poppins" }}>{s.val}</div>
              <div style={{ fontSize:10, color:C.textSub, fontWeight:600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <GlassCard style={{ padding:"16px" }}>
          <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:12, letterSpacing:0.5 }}>QUICK ACTIONS</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
            <QuickActionBtn icon="📚" label="Learning Mode" grad="linear-gradient(135deg,#10b981,#059669)" onClick={()=>setSubPage("learning")} />
            <QuickActionBtn icon="🃏" label="Flashcards" grad="linear-gradient(135deg,#8b5cf6,#7c3aed)" onClick={()=>setSubPage("flashcards")} />
            <QuickActionBtn icon="⚡" label="Quick Quiz" grad="linear-gradient(135deg,#6366f1,#4f46e5)" onClick={()=>setSubPage("quiz")} />
            <QuickActionBtn icon="🔴" label="Weak Topics" grad="linear-gradient(135deg,#ef4444,#dc2626)" onClick={()=>setSubPage("weak")} />
            <QuickActionBtn icon="🤖" label="AI Generator" grad="linear-gradient(135deg,#8b5cf6,#6366f1)" onClick={()=>setSubPage("aigen")} />
            <QuickActionBtn icon="∑" label="Formulas" grad="linear-gradient(135deg,#6366f1,#8b5cf6)" onClick={()=>setSubPage("formulas")} />
            <QuickActionBtn icon="🧠" label="Mnemonics" grad="linear-gradient(135deg,#ec4899,#db2777)" onClick={()=>setSubPage("mnemonics")} />
            <QuickActionBtn icon="📅" label="Planner" grad="linear-gradient(135deg,#06b6d4,#0284c7)" onClick={()=>setSubPage("planner")} />
            <QuickActionBtn icon="📊" label="Analytics" grad="linear-gradient(135deg,#f59e0b,#f97316)" onClick={()=>setPage("analytics")} />
          </div>
        </GlassCard>

        {/* Live Weak Topics from AR data */}
        {weakTopics.length > 0 && (
          <GlassCard style={{ padding:"16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:800, color:C.text }}>⚠️ WEAK TOPICS (Live)</div>
              <button onClick={()=>setSubPage("weak")} style={{ fontSize:11, color:C.primary, background:"none", border:"none", cursor:"pointer", fontWeight:700 }}>View All →</button>
            </div>
            {weakTopics.slice(0,3).map((t,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:t.stats.accuracy<40?"#fee2e218":"#fef3c718", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{t.stats.accuracy<40?"🔴":"🟡"}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:C.text }}>{t.topic}</div>
                  <ProgressBar value={t.stats.accuracy} color={t.stats.accuracy<40?"#ef4444":"#f59e0b"} height={4} />
                </div>
                <div style={{ fontSize:13, fontWeight:800, color:t.stats.accuracy<40?"#ef4444":"#f59e0b" }}>{t.stats.accuracy}%</div>
              </div>
            ))}
          </GlassCard>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TESTS PAGE
═══════════════════════════════════════════════════════════════ */
function TestsPage({ setSubPage }) {
  return (
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginBottom:4 }}>Tests & Quizzes</div>
      <div style={{ fontSize:13, color:C.textSub, marginBottom:20 }}>Practice, mock tests and full MDCAT simulation</div>
      {[
        { icon:"⚡", title:"Quick Quiz", desc:"10-30 custom MCQs", sub:"Subject, chapter or mixed", grad:"linear-gradient(135deg,#6366f1,#4f46e5)", action:"quiz" },
        { icon:"📋", title:"Full MDCAT Test", desc:"180 MCQs · 3h 30min", sub:"Simulates real MDCAT exam", grad:"linear-gradient(135deg,#ef4444,#dc2626)", action:"fulltest" },
        { icon:"🔥", title:"Daily Challenge", desc:"10 MCQs · 15 min", sub:"All subjects · +50 XP", grad:"linear-gradient(135deg,#f97316,#ef4444)", action:"daily" },
        { icon:"🔴", title:"Weak Topic Drill", desc:"Focus on your weaknesses", sub:"Based on real performance data", grad:"linear-gradient(135deg,#f59e0b,#d97706)", action:"weak" },
        { icon:"📚", title:"Learning Mode", desc:"Study by chapter", sub:"Active recall + self-rating", grad:"linear-gradient(135deg,#10b981,#059669)", action:"learning" },
        { icon:"🤖", title:"AI MCQ Generator", desc:"From your textbook content", sub:"Intelligent enrichment", grad:"linear-gradient(135deg,#8b5cf6,#6366f1)", action:"aigen" },
      ].map((t,i)=>(
        <div key={i} onClick={()=>setSubPage(t.action)} className="card-hover" style={{ background:t.grad, borderRadius:20, padding:"18px 20px", marginBottom:12, cursor:"pointer", position:"relative", overflow:"hidden", boxShadow:"0 6px 20px rgba(0,0,0,0.12)" }}>
          <div style={{ position:"absolute", right:-20, top:-20, fontSize:90, opacity:0.1 }}>{t.icon}</div>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ fontSize:32 }}>{t.icon}</div>
            <div>
              <div style={{ fontSize:17, fontWeight:800, color:"#fff", fontFamily:"Poppins" }}>{t.title}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", fontWeight:600 }}>{t.desc}</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", marginTop:2 }}>{t.sub}</div>
            </div>
            <div style={{ marginLeft:"auto", fontSize:20, color:"rgba(255,255,255,0.6)" }}>›</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   QUIZ MODE (with AR tracking)
═══════════════════════════════════════════════════════════════ */
function QuizMode({ store, setStore, addXP }) {
  const [cfg, setCfg] = useState({ size:10, subject:"all", started:false, done:false });
  const [answers, setAnswers] = useState({});
  const [qi, setQi] = useState(0);
  const [time, setTime] = useState(0);
  const timer = useRef(null);
  const questionStart = useRef(Date.now());

  const qs = cfg.subject==="all" ? SAMPLE_MCQS : SAMPLE_MCQS.filter(q=>q.subject===cfg.subject);
  const quiz = qs.slice(0, cfg.size);

  useEffect(()=>{
    if(cfg.started&&!cfg.done){ timer.current=setInterval(()=>setTime(t=>t+1),1000); }
    return()=>clearInterval(timer.current);
  },[cfg.started,cfg.done]);

  useEffect(()=>{ questionStart.current=Date.now(); },[qi]);

  const finish=()=>{
    clearInterval(timer.current);
    // Record all answers in AR store
    let newStore = store;
    quiz.forEach(q=>{
      const ans = answers[q.id];
      if(ans !== undefined) {
        newStore = AR.recordAttempt(newStore, q.id, ans===q.answer, 30000, ans===q.answer?4:1);
      }
    });
    setStore(newStore);
    saveStore(newStore);
    const cor = quiz.filter(q=>answers[q.id]===q.answer).length;
    addXP(cor*8);
    setCfg(c=>({...c,done:true}));
  };

  if(cfg.done){
    const cor=quiz.filter(q=>answers[q.id]===q.answer).length;
    return (
      <div style={{ padding:"20px 16px 80px" }}>
        <GlassCard style={{ textAlign:"center", padding:28 }}>
          <div style={{ fontSize:52 }}>{Math.round(cor/quiz.length*100)>=70?"🎉":"📚"}</div>
          <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginTop:8 }}>Quiz Complete!</div>
          <div style={{ fontSize:13, color:C.textSub, marginTop:4 }}>Time: {Math.floor(time/60)}m {time%60}s</div>
          <div style={{ display:"flex", justifyContent:"center", gap:12, margin:"16px 0" }}>
            <div style={{ background:C.gradGreen, borderRadius:14, padding:"10px 18px", color:"#fff" }}>
              <div style={{ fontSize:22, fontWeight:900 }}>{cor}/{quiz.length}</div>
              <div style={{ fontSize:10 }}>Correct</div>
            </div>
            <div style={{ background:C.grad, borderRadius:14, padding:"10px 18px", color:"#fff" }}>
              <div style={{ fontSize:22, fontWeight:900 }}>{Math.round(cor/quiz.length*100)}%</div>
              <div style={{ fontSize:10 }}>Accuracy</div>
            </div>
            <div style={{ background:C.gradGold, borderRadius:14, padding:"10px 18px", color:"#fff" }}>
              <div style={{ fontSize:22, fontWeight:900 }}>{cor*8}</div>
              <div style={{ fontSize:10 }}>XP Earned</div>
            </div>
          </div>
          <button onClick={()=>{setCfg({size:10,subject:"all",started:false,done:false});setAnswers({});setQi(0);setTime(0);}} style={{ padding:"12px 28px", borderRadius:12, border:"none", background:C.grad, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Try Again</button>
        </GlassCard>
        {quiz.map(q=>{
          const ua=answers[q.id];
          return (
            <GlassCard key={q.id} style={{ borderLeft:`4px solid ${ua===q.answer?"#10b981":"#ef4444"}` }}>
              <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:16 }}>{ua===q.answer?"✅":"❌"}</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:C.text, marginBottom:4 }}>{q.question}</div>
                  <div style={{ fontSize:12, color:ua===q.answer?"#10b981":"#ef4444" }}>{ua||"Not answered"}{ua!==q.answer&&` · Correct: ${q.answer}. ${q.options[q.answer]}`}</div>
                  <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>{q.explanation}</div>
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>
    );
  }

  if(!cfg.started) return (
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginBottom:20 }}>⚡ Quiz Builder</div>
      <GlassCard>
        <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:12 }}>Questions</div>
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          {[10,20,Math.min(30,qs.length)].map(n=>(
            <button key={n} onClick={()=>setCfg(c=>({...c,size:n}))} style={{ flex:1, padding:"12px 0", borderRadius:12, border:`2px solid ${cfg.size===n?C.primary:"rgba(99,102,241,0.15)"}`, background:cfg.size===n?"#eff6ff":"transparent", color:cfg.size===n?C.primary:C.textSub, fontWeight:800, cursor:"pointer", fontSize:15 }}>{n}</button>
          ))}
        </div>
        <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:12 }}>Subject</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:24 }}>
          {[{id:"all",name:"All",icon:"🎯"},...SUBJECTS].map(s=>(
            <button key={s.id} onClick={()=>setCfg(c=>({...c,subject:s.id}))} style={{ padding:"8px 14px", borderRadius:20, border:`2px solid ${cfg.subject===s.id?C.primary:"rgba(99,102,241,0.15)"}`, background:cfg.subject===s.id?"#eff6ff":"transparent", color:cfg.subject===s.id?C.primary:C.textSub, fontSize:12, fontWeight:700, cursor:"pointer" }}>{s.icon} {s.name}</button>
          ))}
        </div>
        <div style={{ fontSize:11, color:C.textSub, marginBottom:12 }}>Available: {qs.length} questions</div>
        <button onClick={()=>setCfg(c=>({...c,started:true}))} style={{ width:"100%", padding:14, borderRadius:14, border:"none", background:C.grad, color:"#fff", fontSize:15, fontWeight:800, cursor:"pointer" }}>Start Quiz ⚡</button>
      </GlassCard>
    </div>
  );

  const q=quiz[qi];
  return (
    <div style={{ padding:"16px 16px 80px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontSize:12, fontWeight:700, color:C.textSub }}>Q{qi+1}/{quiz.length}</div>
        <div style={{ background:"#eff6ff", padding:"5px 14px", borderRadius:20, fontSize:13, fontWeight:800, color:C.primary }}>⏱ {Math.floor(time/60)}:{String(time%60).padStart(2,"0")}</div>
      </div>
      <ProgressBar value={(qi/quiz.length)*100} color={C.primary} height={5} />
      <GlassCard style={{ marginTop:12, borderTop:`4px solid ${C.primary}` }}>
        <div style={{ fontSize:15, fontWeight:700, color:C.text, lineHeight:1.6, marginBottom:16 }}>{q.question}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
          {Object.entries(q.options).map(([k,v])=>(
            <div key={k} onClick={()=>setAnswers(a=>({...a,[q.id]:k}))} style={{ padding:"13px 16px", borderRadius:14, border:`${answers[q.id]===k?`2px solid ${C.primary}`:"1.5px solid rgba(99,102,241,0.12)"}`, background:answers[q.id]===k?"#eff6ff":"rgba(255,255,255,0.7)", cursor:"pointer", display:"flex", gap:10, transition:"all 0.15s" }}>
              <span style={{ fontWeight:800, fontSize:13 }}>{k}.</span><span style={{ fontSize:13, color:C.text }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setQi(Math.max(0,qi-1))} disabled={qi===0} style={{ flex:1, padding:12, borderRadius:12, border:`1.5px solid ${C.primary}`, background:"none", color:C.primary, fontSize:13, fontWeight:700, cursor:"pointer" }}>← Prev</button>
          {qi===quiz.length-1
            ? <button onClick={finish} style={{ flex:2, padding:12, borderRadius:12, border:"none", background:C.gradGreen, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Finish ✓</button>
            : <button onClick={()=>setQi(qi+1)} style={{ flex:2, padding:12, borderRadius:12, border:"none", background:C.grad, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Next →</button>
          }
        </div>
      </GlassCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DAILY CHALLENGE
═══════════════════════════════════════════════════════════════ */
const DAILY_CHALLENGE = [
  { id:101, question:"Which enzyme unwinds the DNA double helix during replication?", options:{A:"DNA Polymerase",B:"Helicase",C:"Ligase",D:"Primase"}, answer:"B", explanation:"Helicase breaks hydrogen bonds between base pairs, unwinding the double helix to create replication forks. It requires ATP.", difficulty:"medium", subject:"bio" },
  { id:102, question:"The pH of a solution with [H⁺] = 10⁻⁷ M is:", options:{A:"6",B:"7",C:"8",D:"14"}, answer:"B", explanation:"pH = -log[H⁺] = -log(10⁻⁷) = 7. This is neutral pH at 25°C.", difficulty:"easy", subject:"chem" },
  { id:103, question:"A ball thrown vertically upward — at maximum height its acceleration is:", options:{A:"Zero",B:"9.8 m/s² upward",C:"9.8 m/s² downward",D:"Varies continuously"}, answer:"C", explanation:"Gravity always acts downward at 9.8 m/s². At max height velocity=0 but acceleration ≠ 0.", difficulty:"medium", subject:"phy" },
  { id:104, question:"Which of these is NOT a function of the Golgi apparatus?", options:{A:"Protein modification",B:"Packaging vesicles",C:"ATP synthesis",D:"Lipid processing"}, answer:"C", explanation:"ATP synthesis occurs in mitochondria (oxidative phosphorylation) and chloroplasts. Golgi processes, modifies and packages proteins and lipids.", difficulty:"medium", subject:"bio" },
  { id:105, question:"In Le Chatelier's principle, increasing temperature in an exothermic reaction shifts equilibrium:", options:{A:"To the right (products)",B:"To the left (reactants)",C:"No change",D:"Depends on pressure"}, answer:"B", explanation:"Temperature increase = adding heat. In exothermic reactions, heat is a product. Equilibrium shifts LEFT to consume the added heat, reducing the forward reaction.", difficulty:"medium", subject:"chem" },
];

function DailyChallenge({ store, setStore, addXP }) {
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState({});
  const [time, setTime] = useState(15*60);
  const [done, setDone] = useState(false);
  const timer = useRef(null);

  useEffect(()=>{
    timer.current = setInterval(()=>setTime(t=>{
      if(t<=1){clearInterval(timer.current);setDone(true);return 0;}
      return t-1;
    }),1000);
    return()=>clearInterval(timer.current);
  },[]);

  const submit = useCallback(()=>{
    clearInterval(timer.current);
    // Record in AR store
    let newStore = store;
    DAILY_CHALLENGE.forEach(q=>{
      const ans = answers[q.id];
      if(ans!==undefined) newStore = AR.recordAttempt(newStore, q.id, ans===q.answer, 60000, ans===q.answer?4:1);
    });
    setStore(newStore);
    saveStore(newStore);
    const cor = DAILY_CHALLENGE.filter(q=>answers[q.id]===q.answer).length;
    addXP(cor*10);
    setDone(true);
  },[answers, store, setStore, addXP]);

  const pct = Math.round((time/(15*60))*100);
  const fmt = s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  if(done){
    const cor=DAILY_CHALLENGE.filter(q=>answers[q.id]===q.answer).length;
    return (
      <div style={{ padding:"20px 16px 80px" }}>
        <GlassCard style={{ textAlign:"center", padding:32 }}>
          <div style={{ fontSize:56, marginBottom:8 }}>🎉</div>
          <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins" }}>Challenge Complete!</div>
          <div style={{ fontSize:14, color:C.textSub, marginTop:4, marginBottom:20 }}>{cor}/{DAILY_CHALLENGE.length} correct</div>
          <div style={{ display:"flex", justifyContent:"center", gap:16 }}>
            <div style={{ background:C.gradGreen, borderRadius:16, padding:"12px 20px", color:"#fff", textAlign:"center" }}>
              <div style={{ fontSize:24, fontWeight:900 }}>{cor*10}</div>
              <div style={{ fontSize:10 }}>XP Earned</div>
            </div>
            <div style={{ background:C.grad, borderRadius:16, padding:"12px 20px", color:"#fff", textAlign:"center" }}>
              <div style={{ fontSize:24, fontWeight:900 }}>{Math.round(cor/DAILY_CHALLENGE.length*100)}%</div>
              <div style={{ fontSize:10 }}>Accuracy</div>
            </div>
          </div>
        </GlassCard>
        {DAILY_CHALLENGE.map(q=>{
          const ua=answers[q.id];
          return (
            <GlassCard key={q.id} style={{ borderLeft:`4px solid ${ua===q.answer?"#10b981":"#ef4444"}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:6 }}>{q.question}</div>
              <div style={{ fontSize:12, color:ua===q.answer?"#10b981":"#ef4444" }}>Your: {ua||"–"}{ua!==q.answer&&` · Correct: ${q.answer}`}</div>
              <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>{q.explanation}</div>
            </GlassCard>
          );
        })}
      </div>
    );
  }

  const q=DAILY_CHALLENGE[qi];
  return (
    <div style={{ padding:"16px 16px 80px" }}>
      <div style={{ background:C.gradHero, borderRadius:20, padding:"14px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:28 }}>🔥</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:800, color:"rgba(255,255,255,0.85)" }}>DAILY CHALLENGE · {DAILY_CHALLENGE.length} Questions</div>
          <div style={{ height:6, borderRadius:3, background:"rgba(255,255,255,0.2)", marginTop:4, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${pct}%`, background:"#fff", borderRadius:3, transition:"width 1s" }} />
          </div>
        </div>
        <div style={{ fontSize:20, fontWeight:900, color:time<60?"#fca5a5":"#fff", fontFamily:"Poppins" }}>{fmt(time)}</div>
      </div>
      <div style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Question {qi+1} of {DAILY_CHALLENGE.length}</div>
      <GlassCard>
        <div style={{ fontSize:15, fontWeight:700, color:C.text, lineHeight:1.6, marginBottom:16 }}>{q.question}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
          {Object.entries(q.options).map(([k,v])=>(
            <div key={k} onClick={()=>setAnswers(a=>({...a,[q.id]:k}))} style={{ padding:"13px 16px", borderRadius:14, border:`${answers[q.id]===k?`2px solid ${C.primary}`:"1.5px solid rgba(99,102,241,0.12)"}`, background:answers[q.id]===k?"#eff6ff":"rgba(255,255,255,0.7)", cursor:"pointer", display:"flex", gap:10 }}>
              <span style={{ fontWeight:800, fontSize:13 }}>{k}.</span>
              <span style={{ fontSize:13, color:C.text }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <button onClick={()=>setQi(Math.max(0,qi-1))} disabled={qi===0} style={{ padding:"10px 18px", borderRadius:12, border:`1.5px solid ${C.primary}`, background:"none", color:C.primary, fontSize:13, fontWeight:700, cursor:"pointer" }}>← Back</button>
          {qi===DAILY_CHALLENGE.length-1
            ? <button onClick={submit} style={{ padding:"10px 24px", borderRadius:12, border:"none", background:C.gradGreen, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Submit ✓</button>
            : <button onClick={()=>setQi(qi+1)} style={{ padding:"10px 24px", borderRadius:12, border:"none", background:C.grad, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Next →</button>
          }
        </div>
      </GlassCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ANALYTICS — driven by real AR store data
═══════════════════════════════════════════════════════════════ */
function AnalyticsPage({ store }) {
  const qStats = store.questions || {};
  const fcStats = store.flashcards || {};

  const totalAttempts = Object.values(qStats).reduce((s,q)=>s+q.attempts,0);
  const totalCorrect = Object.values(qStats).reduce((s,q)=>s+q.correct,0);
  const overallAcc = totalAttempts>0 ? Math.round(totalCorrect/totalAttempts*100) : 0;

  const subjectStats = SUBJECTS.map(s=>{
    const subQs = SAMPLE_MCQS.filter(q=>q.subject===s.id);
    const attempted = subQs.filter(q=>qStats[`q_${q.id}`]).length;
    const correct = subQs.reduce((acc,q)=>acc+(qStats[`q_${q.id}`]?.correct||0),0);
    const subAttempts = subQs.reduce((acc,q)=>acc+(qStats[`q_${q.id}`]?.attempts||0),0);
    return { ...s, attempted, accuracy: subAttempts>0?Math.round(correct/subAttempts*100):0, total:subQs.length };
  });

  const fcLearned = Object.values(fcStats).filter(c=>c.repetitions>0).length;
  const fcDue = FLASHCARDS.filter(c=>SM2.isDue(fcStats[`fc_${c.id}`]||{})).length;

  const weakTopics = AR.getWeakTopics(store, SAMPLE_MCQS);

  return (
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginBottom:4 }}>📊 Analytics</div>
      <div style={{ fontSize:13, color:C.textSub, marginBottom:16 }}>All data from your actual practice</div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
        {[
          {icon:"🎯",val:totalAttempts>0?`${overallAcc}%`:"–",label:"Real Accuracy",c:"#10b981"},
          {icon:"📝",val:totalAttempts,label:"Total Attempts",c:C.primary},
          {icon:"🃏",val:`${fcLearned}/${FLASHCARDS.length}`,label:"Cards Learned",c:"#8b5cf6"},
        ].map((s,i)=>(
          <div key={i} style={{ ...glass({ padding:"14px 10px", textAlign:"center", borderRadius:16 }) }}>
            <div style={{ fontSize:22 }}>{s.icon}</div>
            <div style={{ fontSize:18, fontWeight:900, color:s.c, fontFamily:"Poppins" }}>{s.val}</div>
            <div style={{ fontSize:10, color:C.textSub, fontWeight:700 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* SRS Status */}
      <GlassCard style={{ padding:"16px" }}>
        <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:12 }}>🃏 SRS Flashcard Status</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
          {[
            {label:"New",val:FLASHCARDS.filter(c=>!fcStats[`fc_${c.id}`]?.repetitions).length,color:"#6366f1"},
            {label:"Learning",val:FLASHCARDS.filter(c=>{const s=fcStats[`fc_${c.id}`];return s?.repetitions>0&&s?.repetitions<3;}).length,color:"#f59e0b"},
            {label:"Mature",val:FLASHCARDS.filter(c=>fcStats[`fc_${c.id}`]?.repetitions>=3).length,color:"#10b981"},
          ].map((s,i)=>(
            <div key={i} style={{ background:`${s.color}10`, borderRadius:12, padding:"10px 8px", textAlign:"center", border:`1px solid ${s.color}25` }}>
              <div style={{ fontSize:20, fontWeight:900, color:s.color }}>{s.val}</div>
              <div style={{ fontSize:10, color:C.textSub, fontWeight:700 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:12, fontSize:11, color:C.textSub }}>Due for review: <strong style={{ color:"#ef4444" }}>{fcDue}</strong> cards</div>
      </GlassCard>

      {/* Subject performance */}
      <GlassCard style={{ padding:"16px" }}>
        <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:14 }}>Subject Performance (Real Data)</div>
        {subjectStats.map(s=>(
          <div key={s.id} style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
              <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{s.icon} {s.name}</span>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <span style={{ fontSize:10, color:C.textSub }}>{s.attempted}/{s.total}</span>
                <span style={{ fontSize:13, fontWeight:800, color:s.attempted>0?s.color:C.textSub }}>{s.attempted>0?`${s.accuracy}%`:"–"}</span>
              </div>
            </div>
            <ProgressBar value={s.attempted>0?s.accuracy:0} color={s.color} height={7} />
          </div>
        ))}
      </GlassCard>

      {/* Per-question breakdown */}
      {weakTopics.length > 0 && (
        <GlassCard style={{ padding:"16px" }}>
          <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:12 }}>⚠️ Weak Questions (Real Data)</div>
          {weakTopics.map((t,i)=>(
            <div key={i} style={{ padding:"10px 0", borderBottom:i<weakTopics.length-1?"1px solid rgba(99,102,241,0.07)":"none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
                <div style={{ fontSize:12, fontWeight:700, color:C.text, flex:1, marginRight:8 }}>{t.question.slice(0,60)}...</div>
                <div style={{ fontSize:13, fontWeight:800, color:t.stats.accuracy<40?"#ef4444":"#f59e0b", flexShrink:0 }}>{t.stats.accuracy}%</div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <Badge label={`${t.stats.attempts} attempts`} color={C.primary} />
                <Badge label={`~${Math.round(t.stats.avgTime/1000)}s avg`} color="#8b5cf6" />
              </div>
            </div>
          ))}
        </GlassCard>
      )}

      {totalAttempts === 0 && (
        <GlassCard style={{ textAlign:"center", padding:32 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>📊</div>
          <div style={{ fontSize:16, fontWeight:800, color:C.text }}>No data yet</div>
          <div style={{ fontSize:12, color:C.textSub, marginTop:4 }}>Complete quizzes and flashcard sessions to see real analytics here</div>
        </GlassCard>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WEAK TOPICS (real data)
═══════════════════════════════════════════════════════════════ */
function WeakTopicsPage({ store, setSubPage }) {
  const weakTopics = AR.getWeakTopics(store, SAMPLE_MCQS);
  return (
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22, fontWeight:900, color:C.text, fontFamily:"Poppins", marginBottom:4 }}>🔴 Weak Topics</div>
      <div style={{ fontSize:13, color:C.textSub, marginBottom:16 }}>Based on your real performance data</div>
      {weakTopics.length === 0 ? (
        <GlassCard style={{ textAlign:"center", padding:32 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>✅</div>
          <div style={{ fontSize:16, fontWeight:800, color:C.text }}>No weak topics yet</div>
          <div style={{ fontSize:12, color:C.textSub, marginTop:4, marginBottom:16 }}>Attempt questions to see your real weak areas here</div>
          <button onClick={()=>setSubPage("learning")} style={{ padding:"10px 20px", borderRadius:12, border:"none", background:C.grad, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Start Learning</button>
        </GlassCard>
      ) : weakTopics.map((t,i)=>(
        <GlassCard key={i} style={{ borderLeft:`4px solid ${t.stats.accuracy<40?"#ef4444":"#f59e0b"}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <div style={{ flex:1, marginRight:10 }}>
              <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:4 }}>{t.topic}</div>
              <div style={{ fontSize:11, color:C.textSub }}>{t.chapter} · {t.stats.attempts} attempts</div>
            </div>
            <div style={{ fontSize:22, fontWeight:900, color:t.stats.accuracy<40?"#ef4444":"#f59e0b", fontFamily:"Poppins" }}>{t.stats.accuracy}%</div>
          </div>
          <ProgressBar value={t.stats.accuracy} color={t.stats.accuracy<40?"#ef4444":"#f59e0b"} height={7} />
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <button onClick={()=>setSubPage("learning")} style={{ flex:1, padding:"10px", borderRadius:12, border:"none", background:C.grad, color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>Practice</button>
            <button onClick={()=>setSubPage("flashcards")} style={{ flex:1, padding:"10px", borderRadius:12, border:`1.5px solid ${C.primary}`, background:"none", color:C.primary, fontSize:12, fontWeight:700, cursor:"pointer" }}>Flashcards</button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUPPORTING PAGES (unchanged logic, kept concise)
═══════════════════════════════════════════════════════════════ */
function AIGenerator() {
  const [text,setText]=useState("");
  const [subject,setSubject]=useState("bio");
  const [chapter,setChapter]=useState("");
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState("");
  const generate=async()=>{
    if(!text.trim())return;
    setLoading(true);setError("");setResult(null);
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,system:AI_SYSTEM_PROMPT,messages:[{role:"user",content:`Subject: ${SUBJECTS.find(s=>s.id===subject)?.name}\nChapter: ${chapter||"Unknown"}\n\nContent:\n${text}`}]})});
      const data=await res.json();
      const raw=data.content.map(i=>i.text||"").join("");
      setResult(JSON.parse(raw.replace(/```json|```/g,"").trim()));
    }catch(e){setError("Generation failed. Check your text and try again.");}
    setLoading(false);
  };
  return(
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22,fontWeight:900,color:C.text,fontFamily:"Poppins",marginBottom:4 }}>🤖 AI MCQ Generator</div>
      <div style={{ fontSize:13,color:C.textSub,marginBottom:16 }}>Paste textbook content → get intelligent MCQs</div>
      <GlassCard style={{ padding:"16px" }}>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11,color:C.textSub,fontWeight:700,marginBottom:5 }}>SUBJECT</div>
            <select value={subject} onChange={e=>setSubject(e.target.value)} style={{ width:"100%",padding:"10px 12px",borderRadius:12,border:"1.5px solid rgba(99,102,241,0.15)",background:"rgba(255,255,255,0.8)",fontSize:12,color:C.text,outline:"none" }}>
              {SUBJECTS.map(s=><option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:11,color:C.textSub,fontWeight:700,marginBottom:5 }}>CHAPTER</div>
            <input value={chapter} onChange={e=>setChapter(e.target.value)} placeholder="Chapter name..." style={{ width:"100%",padding:"10px 12px",borderRadius:12,border:"1.5px solid rgba(99,102,241,0.15)",background:"rgba(255,255,255,0.8)",fontSize:12,color:C.text,outline:"none" }} />
          </div>
        </div>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste textbook text here..." style={{ width:"100%",minHeight:140,padding:"12px",borderRadius:12,border:"1.5px solid rgba(99,102,241,0.15)",background:"rgba(255,255,255,0.8)",fontSize:12,color:C.text,outline:"none",resize:"vertical",fontFamily:"Nunito" }} />
        <button onClick={generate} disabled={loading||!text.trim()} style={{ width:"100%",marginTop:10,padding:14,borderRadius:14,border:"none",background:loading?"rgba(99,102,241,0.4)":C.grad,color:"#fff",fontSize:14,fontWeight:800,cursor:loading?"not-allowed":"pointer" }}>
          {loading?"⟳ Generating...":"🤖 Generate MCQs"}
        </button>
        {error&&<div style={{ fontSize:12,color:"#ef4444",marginTop:8 }}>{error}</div>}
      </GlassCard>
      {result&&(
        <>
          <div style={{ fontSize:15,fontWeight:800,color:C.text,marginBottom:12 }}>📌 {result.topic} — {result.mcqs?.length} MCQs</div>
          {result.mcqs?.map((q,i)=>(
            <GlassCard key={i}>
              <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:8 }}>
                <Badge label={q.type?.toUpperCase()} color={C.primary} />
                <Badge label={q.difficulty?.toUpperCase()} color={q.difficulty==="hard"?"#ef4444":q.difficulty==="medium"?"#f59e0b":"#10b981"} />
                {q.yield_tag&&<Badge label={`⚡ ${q.yield_tag}`} color="#f59e0b" />}
              </div>
              <div style={{ fontSize:14,fontWeight:700,color:C.text,marginBottom:10 }}>Q{i+1}. {q.question}</div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8 }}>
                {Object.entries(q.options||{}).map(([k,v])=>(
                  <div key={k} style={{ padding:"8px 10px",borderRadius:10,border:`1.5px solid ${k===q.answer?"#10b981":"rgba(99,102,241,0.1)"}`,background:k===q.answer?"#f0fdf4":"rgba(255,255,255,0.7)",fontSize:11,color:k===q.answer?"#065f46":C.text }}>
                    <span style={{ fontWeight:800 }}>{k}.</span> {v}
                  </div>
                ))}
              </div>
              {q.explanation&&<div style={{ fontSize:11,color:C.textSub,paddingTop:8,borderTop:"1px solid rgba(99,102,241,0.08)" }}>💡 {q.explanation}</div>}
            </GlassCard>
          ))}
        </>
      )}
    </div>
  );
}

function FormulasPage() {
  const [selSub,setSelSub]=useState("all");
  const filtered=selSub==="all"?FORMULAS:FORMULAS.filter(f=>f.subject===selSub);
  return(
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22,fontWeight:900,color:C.text,fontFamily:"Poppins",marginBottom:12 }}>∑ Formula Sheet</div>
      <div style={{ display:"flex",gap:8,marginBottom:16,overflowX:"auto",paddingBottom:4 }}>
        {[{id:"all",name:"All",icon:"📚"},...SUBJECTS].map(s=>(
          <button key={s.id} onClick={()=>setSelSub(s.id)} style={{ padding:"7px 14px",borderRadius:20,border:"none",background:selSub===s.id?s.grad||C.grad:"rgba(255,255,255,0.8)",color:selSub===s.id?"#fff":C.textSub,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0 }}>{s.icon} {s.name}</button>
        ))}
      </div>
      {filtered.map((f,i)=>(
        <GlassCard key={i} style={{ padding:"14px 16px" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div><div style={{ fontSize:11,color:C.textSub,fontWeight:600,marginBottom:4 }}>{f.topic}</div><div style={{ fontSize:13,color:C.textSub }}>{f.desc}</div></div>
            <div style={{ background:C.grad,borderRadius:12,padding:"10px 16px",fontSize:15,fontWeight:800,color:"#fff",fontFamily:"Poppins" }}>{f.formula}</div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function MnemonicsPage() {
  const [exp,setExp]=useState(null);
  return(
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22,fontWeight:900,color:C.text,fontFamily:"Poppins",marginBottom:14 }}>🧠 Mnemonics</div>
      {MNEMONICS.map((m,i)=>(
        <GlassCard key={i} onClick={()=>setExp(exp===i?null:i)}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex",gap:8,marginBottom:8 }}>
                <Badge label={m.subject.toUpperCase()} color={SUBJECTS.find(s=>s.id===m.subject)?.color||C.primary} />
                <Badge label={m.topic} color={C.primary} />
              </div>
              <div style={{ background:C.gradHero,borderRadius:12,padding:"10px 14px",marginBottom:exp===i?10:0 }}>
                <div style={{ fontSize:13,fontWeight:800,color:"#fff" }}>{m.mnemonic}</div>
              </div>
              {exp===i&&<div style={{ fontSize:12,color:C.text,lineHeight:1.5,padding:"8px 0" }}>{m.full}</div>}
            </div>
            <div style={{ fontSize:16,marginLeft:8,color:C.primary }}>{exp===i?"▲":"▼"}</div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function StudyPlanner() {
  const plan=[
    {day:"Mon",subject:"Biology",chapter:"Cell Biology",hours:2,done:true},
    {day:"Tue",subject:"Chemistry",chapter:"Atomic Structure",hours:2,done:true},
    {day:"Wed",subject:"Physics",chapter:"Thermodynamics",hours:1.5,done:false},
    {day:"Thu",subject:"Biology",chapter:"Genetics",hours:2,done:false},
    {day:"Fri",subject:"Chemistry",chapter:"Equilibrium",hours:2,done:false},
    {day:"Sat",subject:"Mixed",chapter:"Full Mock Test",hours:3.5,done:false},
    {day:"Sun",subject:"Revision",chapter:"Weak Topics Drill",hours:2,done:false},
  ];
  const [done,setDone]=useState(plan.map(p=>p.done));
  return(
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22,fontWeight:900,color:C.text,fontFamily:"Poppins",marginBottom:14 }}>📅 Study Planner</div>
      <GlassCard style={{ background:C.gradHero,padding:"16px" }}>
        <div style={{ fontSize:22,fontWeight:900,color:"#fff",fontFamily:"Poppins" }}>14 Hours This Week</div>
        <ProgressBar value={done.filter(Boolean).length/plan.length*100} color="rgba(255,255,255,0.8)" height={6} />
        <div style={{ fontSize:11,color:"rgba(255,255,255,0.65)",marginTop:4 }}>{done.filter(Boolean).length}/{plan.length} days completed</div>
      </GlassCard>
      {plan.map((p,i)=>{
        const s=SUBJECTS.find(s=>s.name===p.subject)||SUBJECTS[0];
        return(
          <GlassCard key={i} style={{ padding:"14px 16px", opacity:done[i]?0.75:1 }} onClick={()=>setDone(d=>{const n=[...d];n[i]=!n[i];return n;})}>
            <div style={{ display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ width:44,height:44,borderRadius:12,background:done[i]?"#d1fae5":s.grad,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{done[i]?"✅":s.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13,fontWeight:800,color:C.text }}>{p.day} — {p.subject}</div>
                <div style={{ fontSize:11,color:C.textSub }}>{p.chapter} · {p.hours}h</div>
              </div>
              {done[i]&&<Badge label="Done ✓" color="#10b981" />}
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}

function SettingsPage({ store, setStore }) {
  const [name,setName]=useState("Mehran");
  const clearData = () => {
    if(window.confirm("Clear all progress data? This cannot be undone.")) {
      setStore({});
      saveStore({});
    }
  };
  const qCount = Object.keys(store.questions||{}).length;
  const fcCount = Object.keys(store.flashcards||{}).length;
  return(
    <div style={{ padding:"20px 16px 80px" }}>
      <div style={{ fontSize:22,fontWeight:900,color:C.text,fontFamily:"Poppins",marginBottom:20 }}>⚙️ Settings</div>
      <GlassCard style={{ textAlign:"center",padding:28 }}>
        <div style={{ width:72,height:72,borderRadius:"50%",background:C.gradHero,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 12px" }}>👤</div>
        <div style={{ fontSize:18,fontWeight:800,color:C.text }}>{name}</div>
        <div style={{ fontSize:12,color:C.textSub }}>MDCAT 2025 Aspirant</div>
      </GlassCard>
      <GlassCard style={{ padding:"16px" }}>
        <div style={{ fontSize:13,fontWeight:800,color:C.text,marginBottom:12 }}>Profile</div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11,color:C.textSub,fontWeight:700,marginBottom:5 }}>YOUR NAME</div>
          <input value={name} onChange={e=>setName(e.target.value)} style={{ width:"100%",padding:"10px 14px",borderRadius:12,border:"1.5px solid rgba(99,102,241,0.15)",background:"rgba(255,255,255,0.8)",fontSize:13,color:C.text,outline:"none" }} />
        </div>
      </GlassCard>
      <GlassCard style={{ padding:"16px" }}>
        <div style={{ fontSize:13,fontWeight:800,color:C.text,marginBottom:12 }}>Progress Data</div>
        {[["Questions attempted",qCount],["Flashcards in SRS",fcCount],["Storage","localStorage"]].map(([k,v],i)=>(
          <div key={i} style={{ display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:i<2?"1px solid rgba(99,102,241,0.06)":"none" }}>
            <span style={{ fontSize:12,color:C.textSub }}>{k}</span>
            <span style={{ fontSize:12,fontWeight:700,color:C.text }}>{v}</span>
          </div>
        ))}
        <button onClick={clearData} style={{ width:"100%",marginTop:14,padding:12,borderRadius:12,border:"1.5px solid #ef4444",background:"none",color:"#ef4444",fontSize:13,fontWeight:700,cursor:"pointer" }}>🗑️ Clear All Progress</button>
      </GlassCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [page, setPage] = useState("home");
  const [subPage, setSubPage] = useState(null);
  const [store, setStore] = useState(()=>loadStore());
  const [xp, setXp] = useState(()=>loadStore().xp||0);
  const [streak] = useState(7);

  const addXP = useCallback((amt) => {
    setXp(x => {
      const newXp = x + amt;
      const newStore = { ...loadStore(), xp: newXp };
      saveStore(newStore);
      return newXp;
    });
  }, []);

  // Keep store and xp in sync
  const handleSetStore = useCallback((newStore) => {
    setStore(newStore);
    saveStore({ ...newStore, xp });
  }, [xp]);

  const subPageTitles = {
    learning:"📚 Learning Mode", daily:"🔥 Daily Challenge", quiz:"⚡ Quiz",
    fulltest:"📋 Full MDCAT Test", flashcards:"🃏 Flashcards", weak:"🔴 Weak Topics",
    aigen:"🤖 AI Generator", formulas:"∑ Formulas", mnemonics:"🧠 Mnemonics",
    planner:"📅 Study Planner",
  };

  const renderSubPage = () => {
    const props = { store, setStore:handleSetStore, addXP };
    switch(subPage){
      case "learning": return <LearningMode {...props} />;
      case "daily": return <DailyChallenge {...props} />;
      case "quiz": return <QuizMode {...props} />;
      case "flashcards": return <FlashcardsPage {...props} />;
      case "weak": return <WeakTopicsPage store={store} setSubPage={setSubPage} />;
      case "aigen": return <AIGenerator />;
      case "formulas": return <FormulasPage />;
      case "mnemonics": return <MnemonicsPage />;
      case "planner": return <StudyPlanner />;
      case "fulltest": return <QuizMode {...props} />;
      default: return null;
    }
  };

  const renderPage = () => {
    if(subPage) return renderSubPage();
    switch(page){
      case "home": return <HomePage setPage={setPage} setSubPage={setSubPage} store={store} xp={xp} streak={streak} />;
      case "tests": return <TestsPage setSubPage={setSubPage} />;
      case "ai": return <AIGenerator />;
      case "analytics": return <AnalyticsPage store={store} />;
      case "settings": return <SettingsPage store={store} setStore={handleSetStore} />;
      default: return <HomePage setPage={setPage} setSubPage={setSubPage} store={store} xp={xp} streak={streak} />;
    }
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ background:C.bg, minHeight:"100vh", maxWidth:480, margin:"0 auto", position:"relative", fontFamily:"Nunito" }}>
        {subPage && (
          <div style={{ position:"sticky",top:0,zIndex:150,background:"rgba(240,244,255,0.95)",backdropFilter:"blur(10px)",borderBottom:"1px solid rgba(99,102,241,0.08)",padding:"12px 16px",display:"flex",alignItems:"center",gap:10 }}>
            <button onClick={()=>setSubPage(null)} style={{ background:C.grad,border:"none",borderRadius:10,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:16,cursor:"pointer",flexShrink:0 }}>‹</button>
            <div style={{ fontSize:14,fontWeight:800,color:C.text }}>{subPageTitles[subPage]||"Back"}</div>
          </div>
        )}
        {renderPage()}
        <BottomNav page={page} setPage={(p)=>{setSubPage(null);setPage(p);}} />
      </div>
    </>
  );
}
