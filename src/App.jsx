import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Trash2, Pencil, Check, X, Fuel, Truck, Users, Building2,
  Gauge, ClipboardList, LayoutDashboard, AlertTriangle, Save,
  ChevronDown, Search, Droplets, Warehouse, Lock, Unlock, Eye, Settings
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from "recharts";
import { storageGet, storageSet } from "./lib/storage.js";

/* ---------------------------------------------------------------------
   TOKENS
--------------------------------------------------------------------- */
const C = {
  bg: "#12161A",
  panel: "#1A1F25",
  panelAlt: "#20262D",
  border: "#2B333B",
  borderLight: "#374049",
  text: "#EDEAE3",
  textDim: "#8E969E",
  textFaint: "#5C646C",
  accent: "#E0A536",
  accentDim: "#7A5E28",
  steel: "#5B8CAE",
  green: "#4C9A6A",
  greenBg: "#1B2A22",
  yellow: "#D9A441",
  yellowBg: "#2B2416",
  red: "#C4463A",
  redBg: "#2C1A18",
};

const MONO = "'IBM Plex Mono','SF Mono',Menlo,Consolas,monospace";
const DISPLAY = "'Arial Narrow',Arial,sans-serif";

/* ---------------------------------------------------------------------
   HELPERS
--------------------------------------------------------------------- */
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const monthLabel = (isoDate) => {
  if (!isoDate) return "—";
  const [y, m] = isoDate.split("-");
  const names = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${names[parseInt(m, 10) - 1]}/${y}`;
};
const monthKey = (isoDate) => (isoDate ? isoDate.slice(0, 7) : "—");

const fmtL = (v) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;
const fmtKg = (v) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
const fmtR = (v) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function tempoPatio(chegada, saida) {
  if (!chegada || !saida) return null;
  const [ch, cm] = chegada.split(":").map(Number);
  const [sh, sm] = saida.split(":").map(Number);
  let mins = (sh * 60 + sm) - (ch * 60 + cm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}
const fmtMins = (mins) => {
  if (mins === null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
};

function computeCarga(row, veiculos, config) {
  const pesoLiquido = num(row.pesoBruto) - num(row.drenagem) - num(row.tara);
  const densidade = num(row.densidade);
  const volumeComBSW = densidade > 0 ? pesoLiquido / densidade : 0;
  const bswFrac = num(row.bsw) / 100;
  const bswL = volumeComBSW * bswFrac;
  const volumeLiquido = volumeComBSW - bswL;
  const ofertado = num(row.ofertado);

  // Divergência: pode ser calculada em Litros ou em Kg, conforme configuração.
  const unidade = config?.unidadeDivergencia || "L";
  const divergencia = unidade === "KG"
    ? (ofertado * densidade) - (pesoLiquido * (1 - bswFrac))
    : ofertado - volumeLiquido;

  const limite = num(config?.limiteDivergencia ?? 100);
  const alertaLigado = config?.alertaDivergencia !== false;
  const divergenciaAlta = alertaLigado && Math.abs(divergencia) > limite;

  const custoUnit = num(row.custoUnit); // já inclui qualquer componente interno (ex: FI)
  const frete = num(row.frete);
  const valorProduto = volumeLiquido * custoUnit;
  const valorFrete = volumeComBSW * frete;
  const custoMercadoria = valorProduto + valorFrete;

  // Tributos: cada um é uma alíquota em %, aplicada sobre o Volume Líquido (L).
  const icms = volumeLiquido * (num(row.icms) / 100);
  const pis = volumeLiquido * (num(row.pis) / 100);
  const cofins = volumeLiquido * (num(row.cofins) / 100);
  const totalTributos = icms + pis + cofins;

  const valorTotal = custoMercadoria + totalTributos;
  const tp = tempoPatio(row.chegada, row.saida);

  const veic = veiculos.find(
    (v) => v.placa.trim().toUpperCase() === (row.placa || "").trim().toUpperCase()
  );
  const placaCadastrada = !!veic;
  const transportadora = row.placa ? (veic ? veic.transportadora : "PLACA NÃO CADASTRADA") : "";

  return {
    pesoLiquido, volumeComBSW, bswL, volumeLiquido, divergencia, divergenciaAlta,
    valorProduto, valorFrete, custoMercadoria, icms, pis, cofins, totalTributos,
    valorTotal, tempoMin: tp, transportadora, placaCadastrada, unidadeDivergencia: unidade,
  };
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Trava de conveniência apenas — não é segurança real (veja aviso no chat).
// Peça pra trocar essa senha por outra a qualquer momento.
const ADMIN_PASSWORD = "admin123";

const STATUS_OPTIONS = ["PENDENTE", "RECEBIDO", "EM ANÁLISE", "CANCELADO"];

const STATUS_STYLE = {
  PENDENTE: { fg: C.yellow, bg: C.yellowBg },
  "RECEBIDO": { fg: C.green, bg: C.greenBg },
  CANCELADO: { fg: C.red, bg: C.redBg },
  "EM ANÁLISE": { fg: C.steel, bg: "#1B2530" },
};

const emptyForm = {
  data: "", chegada: "", saida: "", placa: "", motorista: "", notaFiscal: "", fornecedor: "", produto: "",
  api: "", ofertado: "", pesoBruto: "", drenagem: "0", tara: "", densidade: "",
  bsw: "", tanque: "", custoUnit: "", frete: "", icms: "0", pis: "0", cofins: "0", status: "PENDENTE",
  observacoes: "", lote: "",
};

const SEED_CONFIG = {
  produtoPadrao: "Petróleo Bruto",
  aplicarProdutoPadrao: true,
  statusPadrao: "PENDENTE",
  unidadeDivergencia: "L", // "L" ou "KG"
  limiteDivergencia: 100,
  alertaDivergencia: true,
};

const SEED_CADASTROS = {
  motoristas: [
    { id: uid(), nome: "Edmundo do Amaral Pereira", telefone: "", status: "ATIVO" },
    { id: uid(), nome: "Edmundo do Amaral Pereira Junior", telefone: "", status: "ATIVO" },
    { id: uid(), nome: "Jeremias Vital Rafael Filho", telefone: "", status: "ATIVO" },
    { id: uid(), nome: "Jusivaldo de Aquino Carneiro", telefone: "", status: "ATIVO" },
    { id: uid(), nome: "Nelson Guedes da Silva", telefone: "", status: "ATIVO" },
  ],
  fornecedores: [
    { id: uid(), nome: "EPG Brasil LTDA", cnpj: "", status: "ATIVO" },
    { id: uid(), nome: "Magellan Energia e Participações LTDA", cnpj: "", status: "ATIVO" },
    { id: uid(), nome: "Nova Petróleo - Alagoinhas", cnpj: "", status: "ATIVO" },
    { id: uid(), nome: "Slim / Geopar - Geosol Participações", cnpj: "", status: "ATIVO" },
  ],
  veiculos: [
    { id: uid(), placa: "IPD7G85 / KXW4B75", transportadora: "EPG Brasil LTDA", observacoes: "", status: "ATIVO" },
    { id: uid(), placa: "IPG7G85 / KXW4B75", transportadora: "Magellan Energia e Participações LTDA", observacoes: "", status: "ATIVO" },
    { id: uid(), placa: "JSD5265 / OLA2E43", transportadora: "Nova Petróleo - Alagoinhas", observacoes: "", status: "ATIVO" },
    { id: uid(), placa: "JSD5265 / OUS3160", transportadora: "Slim / Geopar - Geosol Participações", observacoes: "", status: "ATIVO" },
    { id: uid(), placa: "LKX5116 / LPR8H44", transportadora: "", observacoes: "", status: "ATIVO" },
  ],
  produtos: [
    { id: uid(), nome: "Petróleo Bruto", unidade: "L", status: "ATIVO" },
  ],
  tanques: [
    { id: uid(), nome: "TQ - 0104", capacidade: "60000", produto: "Petróleo Bruto", status: "ATIVO" },
  ],
};

const CODIGO_PREFIXO = { fornecedores: "FOR", motoristas: "MOT", veiculos: "VEI", produtos: "PRO", tanques: "TAN" };
function codigoCadastro(sub, list, row) {
  const idx = list.findIndex((r) => r.id === row.id);
  return `${CODIGO_PREFIXO[sub]}${String(idx + 1).padStart(3, "0")}`;
}

/* ---------------------------------------------------------------------
   SMALL UI PRIMITIVES
--------------------------------------------------------------------- */
function Field({ label, children, hint, required }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{
        fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
        color: C.textDim, fontWeight: 600,
      }}>
        {label}{required && <span style={{ color: C.accent }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: C.textFaint }}>{hint}</span>}
    </label>
  );
}

const inputBase = {
  background: C.panelAlt,
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  color: C.text,
  padding: "8px 10px",
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

function Input(props) {
  return (
    <input
      {...props}
      style={{ ...inputBase, ...(props.style || {}) }}
      onFocus={(e) => { e.target.style.borderColor = C.accent; props.onFocus?.(e); }}
      onBlur={(e) => { e.target.style.borderColor = C.border; props.onBlur?.(e); }}
    />
  );
}

function Select({ children, ...props }) {
  return (
    <div style={{ position: "relative" }}>
      <select
        {...props}
        style={{ ...inputBase, appearance: "none", paddingRight: 28, cursor: "pointer" }}
      >
        {children}
      </select>
      <ChevronDown size={14} color={C.textDim}
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
    </div>
  );
}

function Btn({ children, variant = "primary", ...props }) {
  const styles = {
    primary: { background: C.accent, color: "#1A1305", border: "none" },
    ghost: { background: "transparent", color: C.text, border: `1px solid ${C.border}` },
    danger: { background: "transparent", color: C.red, border: `1px solid ${C.red}55` },
  };
  return (
    <button
      {...props}
      style={{
        ...styles[variant],
        padding: "9px 16px", borderRadius: 4, fontSize: 13, fontWeight: 700,
        letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 6, transition: "opacity .15s",
        ...(props.style || {}),
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      {children}
    </button>
  );
}

function Pill({ text, fg, bg }) {
  return (
    <span style={{
      background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "3px 9px",
      borderRadius: 20, letterSpacing: "0.04em", textTransform: "uppercase",
      border: `1px solid ${fg}33`, whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );
}

function Gage({ pct }) {
  const color = pct >= 95 ? C.red : pct >= 75 ? C.yellow : C.green;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: C.panelAlt, borderRadius: 3, overflow: "hidden", border: `1px solid ${C.border}` }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, transition: "width .3s" }} />
      </div>
      <span style={{ fontFamily: MONO, fontSize: 12, color, minWidth: 38, textAlign: "right" }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6,
      padding: 20, ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title }) {
  return (
    <div style={{ marginBottom: 18 }}>
      {eyebrow && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.accent, letterSpacing: "0.12em", marginBottom: 4 }}>
          {eyebrow}
        </div>
      )}
      <h2 style={{
        fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, letterSpacing: "0.01em",
        textTransform: "uppercase", margin: 0, color: C.text,
      }}>
        {title}
      </h2>
    </div>
  );
}

/* ---------------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------------- */
export default function App() {
  const [tab, setTab] = useState("historico");
  const [cargas, setCargas] = useState([]);
  const [cadastros, setCadastros] = useState(SEED_CADASTROS);
  const [config, setConfig] = useState(SEED_CONFIG);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const showToast = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), kind === "err" ? 8000 : 2600);
  }, []);

  useEffect(() => {
    if (!isAdmin && tab === "config") setTab("historico");
  }, [isAdmin, tab]);

  // load
  useEffect(() => {
    (async () => {
      try {
        const c = await storageGet("scrc_cargas");
        if (c && c.value) setCargas(JSON.parse(c.value));
      } catch (e) { /* no data yet */ }
      try {
        const r = await storageGet("scrc_cadastros");
        if (r && r.value) setCadastros(JSON.parse(r.value));
        else await storageSet("scrc_cadastros", JSON.stringify(SEED_CADASTROS));
      } catch (e) {
        try { await storageSet("scrc_cadastros", JSON.stringify(SEED_CADASTROS)); } catch (_) {}
      }
      try {
        const cfg = await storageGet("scrc_config");
        if (cfg && cfg.value) setConfig({ ...SEED_CONFIG, ...JSON.parse(cfg.value) });
        else await storageSet("scrc_config", JSON.stringify(SEED_CONFIG));
      } catch (e) {
        try { await storageSet("scrc_config", JSON.stringify(SEED_CONFIG)); } catch (_) {}
      }
      setLoading(false);
    })();
  }, []);

  const persistCargas = useCallback(async (next) => {
    setCargas(next);
    try {
      await storageSet("scrc_cargas", JSON.stringify(next));
    } catch (e) { showToast("Não consegui salvar: " + (e?.message || "erro desconhecido") + (e?.hint ? " — " + e.hint : ""), "err"); console.error("Erro ao salvar:", e); }
  }, [showToast]);

  const persistCadastros = useCallback(async (next) => {
    setCadastros(next);
    try {
      await storageSet("scrc_cadastros", JSON.stringify(next));
    } catch (e) { showToast("Não consegui salvar: " + (e?.message || "erro desconhecido") + (e?.hint ? " — " + e.hint : ""), "err"); console.error("Erro ao salvar:", e); }
  }, [showToast]);

  const persistConfig = useCallback(async (next) => {
    setConfig(next);
    try {
      await storageSet("scrc_config", JSON.stringify(next));
    } catch (e) { showToast("Não consegui salvar: " + (e?.message || "erro desconhecido") + (e?.hint ? " — " + e.hint : ""), "err"); console.error("Erro ao salvar:", e); }
  }, [showToast]);

  const veiculosAtivos = useMemo(
    () => cadastros.veiculos.filter((v) => v.status === "ATIVO"),
    [cadastros.veiculos]
  );

  const TABS = [
    { id: "lancar", label: "Lançar Carga", icon: Plus },
    { id: "historico", label: "Histórico", icon: ClipboardList },
    { id: "painel", label: "Painel Resumo", icon: LayoutDashboard },
    { id: "cadastros", label: "Cadastros", icon: Warehouse },
    ...(isAdmin ? [{ id: "config", label: "Configurações", icon: Settings }] : []),
  ];

  if (loading) {
    return (
      <div style={{
        background: C.bg, minHeight: 480, display: "flex", alignItems: "center",
        justifyContent: "center", color: C.textDim, fontFamily: MONO, fontSize: 13,
      }}>
        carregando dados salvos…
      </div>
    );
  }

  return (
    <div style={{
      background: C.bg, minHeight: "100%", fontFamily: "'Inter',system-ui,-apple-system,sans-serif",
      color: C.text, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`,
    }}>
      {/* TOPBAR */}
      <div style={{
        background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 6, background: C.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Fuel size={19} color="#1A1305" />
          </div>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, letterSpacing: "0.03em", lineHeight: 1 }}>
              SCRC
            </div>
            <div style={{ fontSize: 10.5, color: C.textDim, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Controle de Recebimento de Cargas
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <nav style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "9px 14px",
                    background: active ? C.panelAlt : "transparent",
                    color: active ? C.accent : C.textDim,
                    border: `1px solid ${active ? C.borderLight : "transparent"}`,
                    borderBottom: active ? `2px solid ${C.accent}` : `2px solid transparent`,
                    borderRadius: 4, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                    letterSpacing: "0.03em", textTransform: "uppercase",
                  }}
                >
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </nav>

          {isAdmin ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pill text="Modo admin" fg={C.accent} bg={`${C.accentDim}33`} />
              <button onClick={() => setIsAdmin(false)}
                title="Sair do modo admin"
                style={{
                  display: "flex", alignItems: "center", gap: 6, background: "transparent",
                  border: `1px solid ${C.border}`, borderRadius: 4, color: C.textDim,
                  padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  textTransform: "uppercase", letterSpacing: "0.03em",
                }}>
                <Unlock size={13} /> Sair
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pill text="Modo visitante" fg={C.textDim} bg={C.panelAlt} />
              <button onClick={() => setShowLogin(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, background: "transparent",
                  border: `1px solid ${C.border}`, borderRadius: 4, color: C.textDim,
                  padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  textTransform: "uppercase", letterSpacing: "0.03em",
                }}>
                <Lock size={13} /> Entrar como admin
              </button>
            </div>
          )}
        </div>
      </div>

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSubmit={(pwd) => {
            if (pwd === ADMIN_PASSWORD) {
              setIsAdmin(true);
              setShowLogin(false);
              showToast("Modo admin ativado.");
            } else {
              showToast("Senha incorreta.", "err");
            }
          }}
        />
      )}

      {/* CONTENT */}
      <div style={{ padding: 24 }}>
        {tab === "lancar" && (
          isAdmin ? (
            <LancarCarga
              cadastros={cadastros}
              config={config}
              onSave={(row) => {
                persistCargas([...cargas, { ...row, id: uid() }]);
                showToast("Carga registrada.");
              }}
            />
          ) : <ReadOnlyNotice onEnter={() => setShowLogin(true)} text="Somente administradores podem lançar cargas." />
        )}
        {tab === "historico" && (
          <Historico
            cargas={cargas}
            cadastros={cadastros}
            config={config}
            isAdmin={isAdmin}
            onDelete={(id) => { persistCargas(cargas.filter((c) => c.id !== id)); showToast("Registro excluído."); }}
            onUpdate={(row) => { persistCargas(cargas.map((c) => (c.id === row.id ? row : c))); showToast("Registro atualizado."); }}
          />
        )}
        {tab === "painel" && <PainelResumo cargas={cargas} cadastros={cadastros} config={config} />}
        {tab === "cadastros" && (
          <Cadastros cadastros={cadastros} cargas={cargas} isAdmin={isAdmin} onSave={persistCadastros} config={config} />
        )}
        {tab === "config" && isAdmin && (
          <Configuracoes config={config} cadastros={cadastros} onSave={(next) => { persistConfig(next); showToast("Configurações salvas."); }} />
        )}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, maxWidth: 420, background: toast.kind === "err" ? C.redBg : C.greenBg,
          border: `1px solid ${toast.kind === "err" ? C.red : C.green}55`,
          color: toast.kind === "err" ? C.red : C.green,
          padding: "10px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600,
          display: "flex", alignItems: "flex-start", gap: 8, boxShadow: "0 6px 20px rgba(0,0,0,.4)", zIndex: 50,
        }}>
          <Check size={15} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

function LoginModal({ onClose, onSubmit }) {
  const [pwd, setPwd] = useState("");
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 24, width: 320, maxWidth: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={16} color={C.accent} />
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, textTransform: "uppercase" }}>
              Acesso admin
            </span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>
        <Field label="Senha">
          <Input
            type="password"
            autoFocus
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(pwd); }}
          />
        </Field>
        <div style={{ marginTop: 16 }}>
          <Btn onClick={() => onSubmit(pwd)} style={{ width: "100%", justifyContent: "center" }}>
            Entrar
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyNotice({ text, onEnter }) {
  return (
    <Card style={{ textAlign: "center", padding: "40px 20px" }}>
      <Eye size={26} color={C.textFaint} style={{ marginBottom: 12 }} />
      <div style={{ color: C.textDim, fontSize: 14, marginBottom: 16 }}>{text}</div>
      <Btn variant="ghost" onClick={onEnter}><Lock size={13} /> Entrar como admin</Btn>
    </Card>
  );
}

/* ---------------------------------------------------------------------
   TAB: LANÇAR CARGA
--------------------------------------------------------------------- */
function LancarCarga({ cadastros, config, onSave }) {
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    produto: config.aplicarProdutoPadrao ? config.produtoPadrao : "",
    status: config.statusPadrao || "PENDENTE",
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const calc = useMemo(() => computeCarga(form, cadastros.veiculos, config), [form, cadastros.veiculos, config]);

  const produtosAtivos = cadastros.produtos.filter((p) => p.status === "ATIVO");
  const tanquesAtivos = cadastros.tanques.filter((t) => t.status === "ATIVO");
  const motoristasAtivos = cadastros.motoristas.filter((m) => m.status === "ATIVO");
  const fornecedoresAtivos = cadastros.fornecedores.filter((f) => f.status === "ATIVO");

  const requiredOk = form.data && form.placa && form.produto && form.tanque &&
    form.ofertado && form.pesoBruto && form.tara && form.densidade;

  const submit = () => {
    if (!requiredOk) return;
    const fornecedorSelecionado = cadastros.fornecedores.find((f) => f.nome === form.fornecedor);
    onSave({ ...form, cnpj: fornecedorSelecionado?.cnpj || "" });
    setForm({
      ...emptyForm,
      produto: config.aplicarProdutoPadrao ? config.produtoPadrao : "",
      status: config.statusPadrao || "PENDENTE",
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }} className="scrc-grid">
      <Card>
        <SectionTitle eyebrow="Nova entrada" title="Lançar Carga" />

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="Data" required><Input type="date" value={form.data} onChange={set("data")} /></Field>
            <Field label="Chegada"><Input type="time" value={form.chegada} onChange={set("chegada")} /></Field>
            <Field label="Saída"><Input type="time" value={form.saida} onChange={set("saida")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Placa carreta" required hint={form.placa && !calc.placaCadastrada ? "Placa não cadastrada" : (calc.transportadora ? `Transportadora: ${calc.transportadora}` : " ")}>
              <Select value={form.placa} onChange={set("placa")}>
                <option value="">Selecione…</option>
                {cadastros.veiculos.filter((v) => v.status === "ATIVO").map((v) => <option key={v.id} value={v.placa}>{v.placa}</option>)}
              </Select>
            </Field>
            <Field label="Nota fiscal"><Input value={form.notaFiscal} onChange={set("notaFiscal")} placeholder="NF-000" /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Motorista">
              <Select value={form.motorista} onChange={set("motorista")}>
                <option value="">Selecione…</option>
                {motoristasAtivos.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </Select>
            </Field>
            <Field label="Fornecedor">
              <Select value={form.fornecedor} onChange={set("fornecedor")}>
                <option value="">Selecione…</option>
                {fornecedoresAtivos.map((f) => <option key={f.id} value={f.nome}>{f.nome}</option>)}
              </Select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="Produto" required>
              <Select value={form.produto} onChange={set("produto")}>
                <option value="">Selecione…</option>
                {produtosAtivos.map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
              </Select>
            </Field>
            <Field label="API"><Input type="number" value={form.api} onChange={set("api")} /></Field>
            <Field label="Ofertado NF (L)" required><Input type="number" value={form.ofertado} onChange={set("ofertado")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="Peso bruto (kg)" required><Input type="number" value={form.pesoBruto} onChange={set("pesoBruto")} /></Field>
            <Field label="Drenagem água (L)"><Input type="number" value={form.drenagem} onChange={set("drenagem")} /></Field>
            <Field label="Tara (kg)" required><Input type="number" value={form.tara} onChange={set("tara")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Densidade 20º" required><Input type="number" step="0.001" value={form.densidade} onChange={set("densidade")} /></Field>
            <Field label="BS&W (%)" hint="ex: 1,2 para 1,2%"><Input type="number" step="0.01" value={form.bsw} onChange={set("bsw")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Custo unitário (R$/L)" hint="já deve incluir qualquer componente interno"><Input type="number" step="0.01" value={form.custoUnit} onChange={set("custoUnit")} /></Field>
            <Field label="Frete (R$/L)"><Input type="number" step="0.01" value={form.frete} onChange={set("frete")} /></Field>
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim, fontWeight: 600, marginTop: 4 }}>
            Tributos (%, aplicados sobre o Volume Líquido)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="ICMS (%)" hint="ex: 18 para 18%"><Input type="number" step="0.01" value={form.icms} onChange={set("icms")} /></Field>
            <Field label="PIS (%)" hint="ex: 1,65 para 1,65%"><Input type="number" step="0.01" value={form.pis} onChange={set("pis")} /></Field>
            <Field label="COFINS (%)" hint="ex: 7,6 para 7,6%"><Input type="number" step="0.01" value={form.cofins} onChange={set("cofins")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Tanque destino" required>
              <Select value={form.tanque} onChange={set("tanque")}>
                <option value="">Selecione…</option>
                {tanquesAtivos.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={set("status")}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Lote"><Input value={form.lote} onChange={set("lote")} /></Field>
            <Field label="Observações"><Input value={form.observacoes} onChange={set("observacoes")} /></Field>
          </div>

          <div style={{ marginTop: 6 }}>
            <Btn onClick={submit} style={!requiredOk ? { opacity: 0.4, pointerEvents: "none" } : {}}>
              <Save size={14} /> Registrar carga
            </Btn>
            {!requiredOk && (
              <span style={{ marginLeft: 12, fontSize: 12, color: C.textFaint }}>
                Preencha os campos obrigatórios (*)
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* LIVE PREVIEW */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20, alignSelf: "start", position: "sticky", top: 0 }}>
      <Card>
        <SectionTitle eyebrow="Cálculo automático" title="Prévia" />
        <div style={{ display: "grid", gap: 10, fontFamily: MONO }}>
          <PreviewRow label="Peso líquido" value={fmtKg(calc.pesoLiquido)} />
          <PreviewRow label="Volume c/ BSW" value={fmtL(calc.volumeComBSW)} />
          <PreviewRow label="BS&W" value={fmtL(calc.bswL)} />
          <PreviewRow label="Volume líquido" value={fmtL(calc.volumeLiquido)} accent />
          <PreviewRow
            label={`Divergência (${calc.unidadeDivergencia})`}
            value={`${calc.divergencia.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${calc.unidadeDivergencia}`}
            warn={calc.divergenciaAlta}
          />
          <PreviewRow label="Tempo no pátio" value={fmtMins(calc.tempoMin)} />
          <div style={{ height: 1, background: C.border, margin: "6px 0" }} />
          <PreviewRow label="Valor do produto" value={fmtR(calc.valorProduto)} />
          <PreviewRow label="Valor do frete" value={fmtR(calc.valorFrete)} />
          <PreviewRow label="Custo mercadoria + frete" value={fmtR(calc.custoMercadoria)} />
          <PreviewRow label="ICMS" value={fmtR(calc.icms)} />
          <PreviewRow label="PIS" value={fmtR(calc.pis)} />
          <PreviewRow label="COFINS" value={fmtR(calc.cofins)} />
          <PreviewRow label="Total de tributos" value={fmtR(calc.totalTributos)} />
          <div style={{ height: 1, background: C.border, margin: "6px 0" }} />
          <PreviewRow label="Valor total" value={fmtR(calc.valorTotal)} big />
        </div>
        {calc.divergenciaAlta && (
          <div style={{
            marginTop: 14, display: "flex", gap: 8, alignItems: "flex-start",
            background: C.yellowBg, border: `1px solid ${C.yellow}44`, borderRadius: 4, padding: 10,
          }}>
            <AlertTriangle size={15} color={C.yellow} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: C.yellow }}>
              Divergência acima do limite configurado ({config.limiteDivergencia} {config.unidadeDivergencia}).
            </span>
          </div>
        )}
        {form.placa && !calc.placaCadastrada && (
          <div style={{
            marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start",
            background: C.redBg, border: `1px solid ${C.red}44`, borderRadius: 4, padding: 10,
          }}>
            <AlertTriangle size={15} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: C.red }}>
              Placa não encontrada em Cadastros → Veículos.
            </span>
          </div>
        )}
      </Card>

      {/* VERIFICAÇÃO ESPECÍFICA — Peso Líquido ÷ Densidade = Volume c/ BSW */}
      <Card style={{ alignSelf: "start" }}>
        <SectionTitle eyebrow="Conferência específica" title="Verificação — Volume c/ BSW" />
        <p style={{ fontSize: 12.5, color: C.textDim, marginTop: -8, marginBottom: 16, lineHeight: 1.5 }}>
          Confere isoladamente a conta de Peso Líquido pela Densidade 20º informada — a mesma densidade
          usada no cálculo geral acima, só que destacada aqui sozinha para dupla checagem.
        </p>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
          flexWrap: "wrap", fontFamily: MONO, padding: "8px 0",
        }}>
          <EquationBlock label="Peso líquido" value={fmtKg(calc.pesoLiquido)} />
          <span style={{ fontSize: 22, color: C.textFaint }}>÷</span>
          <EquationBlock label="Densidade 20º" value={num(form.densidade).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} />
          <span style={{ fontSize: 22, color: C.textFaint }}>=</span>
          <EquationBlock label="Volume c/ BSW" value={fmtL(calc.volumeComBSW)} accent big />
        </div>

        <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
          flexWrap: "wrap", fontFamily: MONO, padding: "8px 0",
        }}>
          <EquationBlock label="Volume c/ BSW" value={fmtL(calc.volumeComBSW)} />
          <span style={{ fontSize: 22, color: C.textFaint }}>×</span>
          <EquationBlock label="BS&W (%)" value={`${num(form.bsw).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`} />
          <span style={{ fontSize: 22, color: C.textFaint }}>=</span>
          <EquationBlock label="BS&W (L)" value={fmtL(calc.bswL)} accent big />
        </div>
      </Card>
      </div>
    </div>
  );
}

function EquationBlock({ label, value, accent, big }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      background: C.panelAlt, border: `1px solid ${accent ? C.accent + "55" : C.border}`,
      borderRadius: 6, padding: "10px 16px", minWidth: 120,
    }}>
      <span style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textDim, fontFamily: "'Inter',system-ui,sans-serif" }}>
        {label}
      </span>
      <span style={{ fontSize: big ? 18 : 15, fontWeight: 700, color: accent ? C.accent : C.text }}>
        {value}
      </span>
    </div>
  );
}


function PreviewRow({ label, value, accent, warn, big }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: C.textDim, fontFamily: "'Inter',system-ui,sans-serif" }}>{label}</span>
      <span style={{
        fontSize: big ? 20 : 14, fontWeight: big ? 800 : 500,
        color: warn ? C.yellow : accent ? C.accent : C.text,
      }}>
        {value}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------
   TAB: HISTÓRICO
--------------------------------------------------------------------- */
function Historico({ cargas, cadastros, config, isAdmin, onDelete, onUpdate }) {
  const [monthFilter, setMonthFilter] = useState("todos");
  const [query, setQuery] = useState("");
  const [editingRow, setEditingRow] = useState(null);

  const months = useMemo(() => {
    const s = new Set(cargas.map((c) => monthKey(c.data)));
    return Array.from(s).sort();
  }, [cargas]);

  const nfCounts = useMemo(() => {
    const map = {};
    cargas.forEach((c) => { if (c.notaFiscal) map[c.notaFiscal] = (map[c.notaFiscal] || 0) + 1; });
    return map;
  }, [cargas]);

  const filtered = useMemo(() => {
    return cargas
      .filter((c) => monthFilter === "todos" || monthKey(c.data) === monthFilter)
      .filter((c) => {
        if (!query) return true;
        const q = query.toLowerCase();
        const qDigits = query.replace(/\D/g, "");
        const fornecedor = cadastros.fornecedores.find((f) => f.nome === c.fornecedor);
        const cnpj = c.cnpj || fornecedor?.cnpj || "";
        const campos = [c.placa, c.notaFiscal, c.produto, c.tanque, c.motorista, c.fornecedor, cnpj]
          .join(" ")
          .toLowerCase();
        const cnpjDigits = cnpj.replace(/\D/g, "");

        return campos.includes(q) || (qDigits.length > 0 && cnpjDigits.includes(qDigits));
      })
      .sort((a, b) => (a.data < b.data ? 1 : -1));
  }, [cargas, cadastros.fornecedores, monthFilter, query]);

  return (
    <div>
      <SectionTitle eyebrow={`${cargas.length} registros no total`} title="Histórico de Cargas" />

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={14} color={C.textDim} style={{ position: "absolute", left: 10, top: 11 }} />
          <Input placeholder="Buscar por placa, motorista, fornecedor, CNPJ, NF, produto…" value={query}
            onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 30 }} />
        </div>
        <div style={{ width: 180 }}>
          <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
            <option value="todos">Todos os meses</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m + "-01")}</option>)}
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <div style={{ textAlign: "center", padding: "30px 0", color: C.textDim, fontSize: 13 }}>
            Nenhum registro ainda. Use "Lançar Carga" para começar.
          </div>
        </Card>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1000 }}>
            <thead>
              <tr style={{ background: C.panelAlt }}>
                {[
                  "Data","Placa","Motorista","Fornecedor","CNPJ","Produto","API","Ofertado",
                  "Peso Bruto (KG)","Drenagem Água (L)","Tara (KG)","Densidade 20º","BS&W (%)",
                  "Líquido","Divergência","Custo Unit. (R$/L)","Frete (R$/L)","Valor Frete (R$)","Tributos","Valor Total",
                  "Pátio","Status","NF", isAdmin ? "" : null,
                ].filter((h) => h !== null).map((h) => (
                  <th key={h} style={{
                    textAlign: "left", padding: "9px 12px", fontSize: 10.5, letterSpacing: "0.06em",
                    textTransform: "uppercase", color: C.textDim, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const calc = computeCarga(row, cadastros.veiculos, config);
                const dup = row.notaFiscal && nfCounts[row.notaFiscal] > 1;
                const missing = !row.tanque || !row.produto || !row.placa;
                const st = STATUS_STYLE[row.status] || STATUS_STYLE.PENDENTE;
                const fornecedorCadastro = cadastros.fornecedores.find((f) => f.nome === row.fornecedor);
                const cnpjFornecedor = row.cnpj || fornecedorCadastro?.cnpj || "";
                return (
                  <tr key={row.id} style={{
                    background: missing ? "#2A1F12" : "transparent",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <td style={td}>{row.data ? row.data.split("-").reverse().join("/") : "—"}</td>
                    <td style={{ ...td, fontFamily: MONO, color: !calc.placaCadastrada ? C.red : C.text }}>{row.placa || "—"}</td>
                    <td style={td}>{row.motorista || "—"}</td>
                    <td style={td}>{row.fornecedor || "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{cnpjFornecedor || "—"}</td>
                    <td style={td}>{row.produto || "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.api || "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{fmtL(num(row.ofertado))}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.pesoBruto ? fmtKg(num(row.pesoBruto)) : "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.drenagem ? fmtL(num(row.drenagem)) : "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.tara ? fmtKg(num(row.tara)) : "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.densidade || "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.bsw || "0"}%</td>
                    <td style={{ ...td, fontFamily: MONO }}>{fmtL(calc.volumeLiquido)}</td>
                    <td style={{ ...td, fontFamily: MONO, color: calc.divergenciaAlta ? C.yellow : C.textDim }}>
                      {calc.divergencia.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {calc.unidadeDivergencia}
                    </td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.custoUnit ? fmtR(num(row.custoUnit)) : "—"}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{row.frete ? fmtR(num(row.frete)) : "—"}</td>
                    <td style={{ ...td, fontFamily: MONO, color: C.accent }}>{fmtR(calc.valorFrete)}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{fmtR(calc.totalTributos)}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{fmtR(calc.valorTotal)}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{fmtMins(calc.tempoMin)}</td>
                    <td style={td}><Pill text={row.status} fg={st.fg} bg={st.bg} /></td>
                    <td style={{ ...td, color: dup ? C.red : C.textDim, fontFamily: MONO }}>
                      {row.notaFiscal || "—"}{dup && " ⚠"}
                    </td>
                    {isAdmin && (
                      <td style={{ ...td, display: "flex", gap: 4 }}>
                        <button onClick={() => setEditingRow(row)} title="Editar"
                          style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint, padding: 4 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = C.textFaint)}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => onDelete(row.id)} title="Excluir"
                          style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint, padding: 4 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = C.red)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = C.textFaint)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingRow && (
        <EditCargaModal
          row={editingRow}
          cadastros={cadastros}
          config={config}
          onClose={() => setEditingRow(null)}
          onSave={(updated) => { onUpdate(updated); setEditingRow(null); }}
        />
      )}
    </div>
  );
}
const td = { padding: "9px 12px", whiteSpace: "nowrap" };

/* ---------------------------------------------------------------------
   MODAL: EDITAR CARGA
--------------------------------------------------------------------- */
function EditCargaModal({ row, cadastros, config, onClose, onSave }) {
  const [form, setForm] = useState(row);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const calc = useMemo(() => computeCarga(form, cadastros.veiculos, config), [form, cadastros.veiculos, config]);

  const produtosAtivos = cadastros.produtos.filter((p) => p.status === "ATIVO");
  const tanquesAtivos = cadastros.tanques.filter((t) => t.status === "ATIVO");
  const motoristasAtivos = cadastros.motoristas.filter((m) => m.status === "ATIVO");
  const fornecedoresAtivos = cadastros.fornecedores.filter((f) => f.status === "ATIVO");

  const requiredOk = form.data && form.placa && form.produto && form.tanque &&
    form.ofertado && form.pesoBruto && form.tara && form.densidade;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 100,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 24, width: 720, maxWidth: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <SectionTitle eyebrow="Corrigir lançamento" title="Editar Carga" />
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 14, maxHeight: "65vh", overflowY: "auto", paddingRight: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="Data" required><Input type="date" value={form.data} onChange={set("data")} /></Field>
            <Field label="Chegada"><Input type="time" value={form.chegada} onChange={set("chegada")} /></Field>
            <Field label="Saída"><Input type="time" value={form.saida} onChange={set("saida")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Placa carreta" required>
              <Select value={form.placa} onChange={set("placa")}>
                <option value="">Selecione…</option>
                {cadastros.veiculos.map((v) => <option key={v.id} value={v.placa}>{v.placa}</option>)}
              </Select>
            </Field>
            <Field label="Nota fiscal"><Input value={form.notaFiscal} onChange={set("notaFiscal")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Motorista">
              <Select value={form.motorista} onChange={set("motorista")}>
                <option value="">Selecione…</option>
                {motoristasAtivos.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </Select>
            </Field>
            <Field label="Fornecedor">
              <Select value={form.fornecedor} onChange={set("fornecedor")}>
                <option value="">Selecione…</option>
                {fornecedoresAtivos.map((f) => <option key={f.id} value={f.nome}>{f.nome}</option>)}
              </Select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="Produto" required>
              <Select value={form.produto} onChange={set("produto")}>
                <option value="">Selecione…</option>
                {produtosAtivos.map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
              </Select>
            </Field>
            <Field label="API"><Input type="number" value={form.api} onChange={set("api")} /></Field>
            <Field label="Ofertado NF (L)" required><Input type="number" value={form.ofertado} onChange={set("ofertado")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="Peso bruto (kg)" required><Input type="number" value={form.pesoBruto} onChange={set("pesoBruto")} /></Field>
            <Field label="Drenagem água (L)"><Input type="number" value={form.drenagem} onChange={set("drenagem")} /></Field>
            <Field label="Tara (kg)" required><Input type="number" value={form.tara} onChange={set("tara")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Densidade 20º" required><Input type="number" step="0.001" value={form.densidade} onChange={set("densidade")} /></Field>
            <Field label="BS&W (%)"><Input type="number" step="0.01" value={form.bsw} onChange={set("bsw")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Custo unitário (R$/L)"><Input type="number" step="0.01" value={form.custoUnit} onChange={set("custoUnit")} /></Field>
            <Field label="Frete (R$/L)"><Input type="number" step="0.01" value={form.frete} onChange={set("frete")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <Field label="ICMS (%)"><Input type="number" step="0.01" value={form.icms} onChange={set("icms")} /></Field>
            <Field label="PIS (%)"><Input type="number" step="0.01" value={form.pis} onChange={set("pis")} /></Field>
            <Field label="COFINS (%)"><Input type="number" step="0.01" value={form.cofins} onChange={set("cofins")} /></Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Tanque destino" required>
              <Select value={form.tanque} onChange={set("tanque")}>
                <option value="">Selecione…</option>
                {tanquesAtivos.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={set("status")}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Lote"><Input value={form.lote} onChange={set("lote")} /></Field>
            <Field label="Observações"><Input value={form.observacoes} onChange={set("observacoes")} /></Field>
          </div>
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}`,
        }}>
          <span style={{ fontFamily: MONO, fontSize: 13, color: C.textDim }}>
            Valor total: <strong style={{ color: C.accent }}>{fmtR(calc.valorTotal)}</strong>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn onClick={() => {
              if (!requiredOk) return;
              const fornecedorSelecionado = cadastros.fornecedores.find((f) => f.nome === form.fornecedor);
              onSave({ ...form, cnpj: fornecedorSelecionado?.cnpj || form.cnpj || "" });
            }} style={!requiredOk ? { opacity: 0.4, pointerEvents: "none" } : {}}>
              <Check size={14} /> Salvar alterações
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   TAB: PAINEL RESUMO
--------------------------------------------------------------------- */
function PainelResumo({ cargas, cadastros, config }) {
  const byMonth = useMemo(() => {
    const map = {};
    cargas.forEach((row) => {
      const mk = monthKey(row.data);
      if (!map[mk]) map[mk] = { mes: mk, ofertado: 0, liquido: 0, divergencia: 0, custo: 0, tributos: 0, n: 0, tempos: [] };
      const calc = computeCarga(row, cadastros.veiculos, config);
      map[mk].ofertado += num(row.ofertado);
      map[mk].liquido += calc.volumeLiquido;
      map[mk].divergencia += calc.divergencia;
      map[mk].custo += calc.valorTotal;
      map[mk].tributos += calc.totalTributos;
      map[mk].n += 1;
      if (calc.tempoMin !== null) map[mk].tempos.push(calc.tempoMin);
    });
    return Object.values(map).sort((a, b) => (a.mes > b.mes ? 1 : -1));
  }, [cargas, cadastros.veiculos, config]);

  const totals = byMonth.reduce((acc, m) => ({
    ofertado: acc.ofertado + m.ofertado, liquido: acc.liquido + m.liquido,
    divergencia: acc.divergencia + m.divergencia, custo: acc.custo + m.custo,
    tributos: acc.tributos + m.tributos, n: acc.n + m.n,
  }), { ofertado: 0, liquido: 0, divergencia: 0, custo: 0, tributos: 0, n: 0 });

  const chartData = byMonth.map((m) => ({
    mes: monthLabel(m.mes + "-01"),
    Ofertado: Math.round(m.ofertado),
    "Líquido": Math.round(m.liquido),
  }));

  if (cargas.length === 0) {
    return (
      <div>
        <SectionTitle eyebrow="Comparativo mensal" title="Painel Resumo" />
        <Card><div style={{ textAlign: "center", padding: "30px 0", color: C.textDim, fontSize: 13 }}>
          Nenhum dado lançado ainda.
        </div></Card>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle eyebrow="Comparativo mensal" title="Painel Resumo" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14, marginBottom: 20 }} className="scrc-stats">
        <Stat label="Ofertado (L)" value={fmtL(totals.ofertado)} />
        <Stat label="Volume líquido (L)" value={fmtL(totals.liquido)} accent />
        <Stat label="Divergência (L)" value={`${totals.divergencia.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
        <Stat label="Tributos" value={fmtR(totals.tributos)} />
        <Stat label="Valor total" value={fmtR(totals.custo)} />
      </div>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>
          Ofertado vs. Volume Líquido por mês
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="mes" stroke={C.textDim} fontSize={12} />
              <YAxis stroke={C.textDim} fontSize={12} />
              <Tooltip contentStyle={{ background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Ofertado" fill={C.steel} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Líquido" fill={C.accent} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 700 }}>
          <thead>
            <tr style={{ background: C.panelAlt }}>
              {["Mês","Ofertado (L)","Líquido (L)","Divergência (L)","Tributos","Valor total","Cargas","Tempo médio pátio"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textDim, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byMonth.map((m) => (
              <tr key={m.mes} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={td}>{monthLabel(m.mes + "-01")}</td>
                <td style={{ ...td, fontFamily: MONO }}>{fmtL(m.ofertado)}</td>
                <td style={{ ...td, fontFamily: MONO }}>{fmtL(m.liquido)}</td>
                <td style={{ ...td, fontFamily: MONO }}>{m.divergencia.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td style={{ ...td, fontFamily: MONO }}>{fmtR(m.tributos)}</td>
                <td style={{ ...td, fontFamily: MONO }}>{fmtR(m.custo)}</td>
                <td style={{ ...td, fontFamily: MONO }}>{m.n}</td>
                <td style={{ ...td, fontFamily: MONO }}>
                  {m.tempos.length ? fmtMins(Math.round(m.tempos.reduce((a, b) => a + b, 0) / m.tempos.length)) : "—"}
                </td>
              </tr>
            ))}
            <tr style={{ background: C.panelAlt, fontWeight: 700 }}>
              <td style={td}>Total geral</td>
              <td style={{ ...td, fontFamily: MONO }}>{fmtL(totals.ofertado)}</td>
              <td style={{ ...td, fontFamily: MONO }}>{fmtL(totals.liquido)}</td>
              <td style={{ ...td, fontFamily: MONO }}>{totals.divergencia.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td style={{ ...td, fontFamily: MONO }}>{fmtR(totals.tributos)}</td>
              <td style={{ ...td, fontFamily: MONO }}>{fmtR(totals.custo)}</td>
              <td style={{ ...td, fontFamily: MONO }}>{totals.n}</td>
              <td style={td}>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 10.5, color: C.textDim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: accent ? C.accent : C.text }}>{value}</div>
    </Card>
  );
}

/* ---------------------------------------------------------------------
   TAB: CADASTROS
--------------------------------------------------------------------- */
const REGISTRY_CONFIG = {
  fornecedores: { label: "Fornecedores", icon: Building2, fields: [{ k: "nome", label: "Fornecedor" }, { k: "cnpj", label: "CNPJ" }] },
  motoristas: { label: "Motoristas", icon: Users, fields: [{ k: "nome", label: "Motorista" }, { k: "telefone", label: "Telefone" }] },
  veiculos: { label: "Veículos", icon: Truck, fields: [{ k: "placa", label: "Placa carreta" }, { k: "transportadora", label: "Transportadora" }, { k: "observacoes", label: "Observações" }] },
  produtos: { label: "Produtos", icon: Droplets, fields: [{ k: "nome", label: "Produto" }, { k: "unidade", label: "Unidade" }] },
  tanques: { label: "Tanques", icon: Gauge, fields: [{ k: "nome", label: "Tanque" }, { k: "capacidade", label: "Capacidade (L)" }, { k: "produto", label: "Produto" }] },
};

function Cadastros({ cadastros, cargas, isAdmin, onSave, config }) {
  const [sub, setSub] = useState("veiculos");
  const cfg = REGISTRY_CONFIG[sub];
  const list = cadastros[sub];

  const currentMonth = new Date().toISOString().slice(0, 7);
  const tankUsage = useMemo(() => {
    const map = {};
    cargas.filter((c) => monthKey(c.data) === currentMonth).forEach((c) => {
      const calc = computeCarga(c, cadastros.veiculos, config);
      map[c.tanque] = (map[c.tanque] || 0) + calc.volumeLiquido;
    });
    return map;
  }, [cargas, cadastros.veiculos, currentMonth, config]);

  const emptyRow = Object.fromEntries(cfg.fields.map((f) => [f.k, ""]));
  const [form, setForm] = useState(emptyRow);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => { setForm(emptyRow); setEditingId(null); }, [sub]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    if (!form[cfg.fields[0].k]) return;
    let nextList;
    if (editingId) {
      nextList = list.map((r) => (r.id === editingId ? { ...r, ...form } : r));
    } else {
      nextList = [...list, { id: uid(), status: "ATIVO", ...form }];
    }
    onSave({ ...cadastros, [sub]: nextList });
    setForm(emptyRow);
    setEditingId(null);
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setForm(Object.fromEntries(cfg.fields.map((f) => [f.k, row[f.k] || ""])));
  };

  const toggleStatus = (row) => {
    onSave({ ...cadastros, [sub]: list.map((r) => r.id === row.id ? { ...r, status: r.status === "ATIVO" ? "INATIVO" : "ATIVO" } : r) });
  };

  const remove = (id) => onSave({ ...cadastros, [sub]: list.filter((r) => r.id !== id) });

  return (
    <div>
      <SectionTitle eyebrow="Dados de referência" title="Cadastros" />

      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {Object.entries(REGISTRY_CONFIG).map(([key, c]) => {
          const Icon = c.icon;
          const active = sub === key;
          return (
            <button key={key} onClick={() => setSub(key)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 13px",
                background: active ? C.panelAlt : "transparent", color: active ? C.accent : C.textDim,
                border: `1px solid ${active ? C.borderLight : C.border}`, borderRadius: 20,
                fontSize: 12, fontWeight: 700, letterSpacing: "0.02em", cursor: "pointer",
              }}>
              <Icon size={13} /> {c.label} <span style={{ opacity: 0.6 }}>({cadastros[key].length})</span>
            </button>
          );
        })}
      </div>

      {isAdmin && (
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cfg.fields.length}, 1fr) auto`, gap: 12, alignItems: "end" }} className="scrc-form-row">
          {cfg.fields.map((f) => (
            <Field key={f.k} label={f.label}>
              {sub === "veiculos" && f.k === "transportadora" ? (
                <Select value={form[f.k]} onChange={set(f.k)}>
                  <option value="">Selecione…</option>
                  {cadastros.fornecedores.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                </Select>
              ) : sub === "tanques" && f.k === "produto" ? (
                <Select value={form[f.k]} onChange={set(f.k)}>
                  <option value="">Selecione…</option>
                  {cadastros.produtos.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                </Select>
              ) : (
                <Input value={form[f.k]} onChange={set(f.k)} />
              )}
            </Field>
          ))}
          <Btn onClick={submit} variant={editingId ? "primary" : "primary"}>
            {editingId ? <><Check size={14} /> Salvar</> : <><Plus size={14} /> Adicionar</>}
          </Btn>
        </div>
        {editingId && (
          <button onClick={() => { setEditingId(null); setForm(emptyRow); }}
            style={{ background: "none", border: "none", color: C.textDim, fontSize: 12, cursor: "pointer", marginTop: 8, padding: 0 }}>
            cancelar edição
          </button>
        )}
      </Card>
      )}

      <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.panelAlt }}>
              <th style={{ textAlign: "left", padding: "9px 12px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textDim, borderBottom: `1px solid ${C.border}` }}>Código</th>
              {cfg.fields.map((f) => (
                <th key={f.k} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textDim, borderBottom: `1px solid ${C.border}` }}>{f.label}</th>
              ))}
              {sub === "tanques" && <th style={{ textAlign: "left", padding: "9px 12px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textDim, borderBottom: `1px solid ${C.border}` }}>Ocupação (mês atual)</th>}
              <th style={{ textAlign: "left", padding: "9px 12px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textDim, borderBottom: `1px solid ${C.border}` }}>Status</th>
              {isAdmin && <th style={{ borderBottom: `1px solid ${C.border}` }}></th>}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={cfg.fields.length + 4} style={{ padding: 20, textAlign: "center", color: C.textDim }}>Nenhum item cadastrado.</td></tr>
            )}
            {list.map((row) => {
              const usage = sub === "tanques" ? (tankUsage[row.nome] || 0) : null;
              const cap = sub === "tanques" ? num(row.capacidade) : null;
              const pct = cap > 0 ? (usage / cap) * 100 : 0;
              return (
                <tr key={row.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: row.status === "INATIVO" ? 0.5 : 1 }}>
                  <td style={{ ...td, fontFamily: MONO, color: C.textFaint }}>{codigoCadastro(sub, list, row)}</td>
                  {cfg.fields.map((f) => (
                    <td key={f.k} style={{ ...td, fontFamily: f.k === "placa" ? MONO : "inherit" }}>{row[f.k] || "—"}</td>
                  ))}
                  {sub === "tanques" && (
                    <td style={{ ...td, minWidth: 160 }}>
                      <Gage pct={pct} />
                      <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 2, fontFamily: MONO }}>{fmtL(usage)} / {fmtL(cap)}</div>
                    </td>
                  )}
                  <td style={td}>
                    {isAdmin ? (
                      <button onClick={() => toggleStatus(row)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        <Pill text={row.status} fg={row.status === "ATIVO" ? C.green : C.textFaint} bg={row.status === "ATIVO" ? C.greenBg : C.panelAlt} />
                      </button>
                    ) : (
                      <Pill text={row.status} fg={row.status === "ATIVO" ? C.green : C.textFaint} bg={row.status === "ATIVO" ? C.greenBg : C.panelAlt} />
                    )}
                  </td>
                  {isAdmin && (
                    <td style={{ ...td, display: "flex", gap: 4 }}>
                      <button onClick={() => startEdit(row)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint, padding: 4 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)} onMouseLeave={(e) => (e.currentTarget.style.color = C.textFaint)}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => remove(row.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint, padding: 4 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = C.red)} onMouseLeave={(e) => (e.currentTarget.style.color = C.textFaint)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   TAB: CONFIGURAÇÕES
--------------------------------------------------------------------- */
function Configuracoes({ config, cadastros, onSave }) {
  const [form, setForm] = useState(config);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value === "SIM" }));

  const dirty = JSON.stringify(form) !== JSON.stringify(config);
  const produtosAtivos = cadastros.produtos.filter((p) => p.status === "ATIVO");

  return (
    <div>
      <SectionTitle eyebrow="Padrões do sistema" title="Configurações" />
      <Card style={{ maxWidth: 640 }}>
        <div style={{ display: "grid", gap: 16 }}>
          <Field label="Produto padrão" hint="Sugerido automaticamente ao abrir Lançar Carga">
            <Select value={form.produtoPadrao} onChange={set("produtoPadrao")}>
              {produtosAtivos.map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
            </Select>
          </Field>
          <Field label="Aplicar produto padrão automaticamente?">
            <Select value={form.aplicarProdutoPadrao ? "SIM" : "NÃO"} onChange={setBool("aplicarProdutoPadrao")}>
              <option value="SIM">Sim</option>
              <option value="NÃO">Não — deixar em branco para escolha manual</option>
            </Select>
          </Field>
          <Field label="Status padrão" hint="Sugerido ao iniciar uma carga">
            <Select value={form.statusPadrao} onChange={set("statusPadrao")}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <div style={{ height: 1, background: C.border }} />
          <Field label="Unidade da divergência" hint="Em qual unidade a divergência é calculada e comparada ao limite">
            <Select value={form.unidadeDivergencia} onChange={set("unidadeDivergencia")}>
              <option value="L">Litros (L)</option>
              <option value="KG">Quilos (KG)</option>
            </Select>
          </Field>
          <Field label={`Limite de divergência (${form.unidadeDivergencia})`} hint="Acima desse valor a carga recebe alerta visual">
            <Input type="number" value={form.limiteDivergencia} onChange={set("limiteDivergencia")} />
          </Field>
          <Field label="Destacar divergência acima do limite?">
            <Select value={form.alertaDivergencia ? "SIM" : "NÃO"} onChange={setBool("alertaDivergencia")}>
              <option value="SIM">Sim</option>
              <option value="NÃO">Não — desligar o alerta visual</option>
            </Select>
          </Field>
          <div style={{
            background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 4, padding: 12,
            fontSize: 12.5, color: C.textDim, lineHeight: 1.5,
          }}>
            <strong style={{ color: C.text }}>Regra de custo:</strong> o campo Custo Unitário deve ser
            preenchido com o valor final aplicável à carga — qualquer componente interno (como um fator
            de ajuste) já deve estar incorporado ao valor digitado. O Valor Total é calculado como
            Volume c/ BSW × (Custo Unitário + Frete).
          </div>
          <div>
            <Btn onClick={() => onSave(form)} style={!dirty ? { opacity: 0.4, pointerEvents: "none" } : {}}>
              <Save size={14} /> Salvar configurações
            </Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
