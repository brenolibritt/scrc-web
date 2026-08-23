import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus, Trash2, Pencil, Check, X, Fuel, Truck, Users, Building2,
  Gauge, ClipboardList, LayoutDashboard, AlertTriangle, Save,
  ChevronDown, Search, Droplets, Warehouse, Lock, Unlock, Eye, Settings,
  FileText, Download, HelpCircle, BookOpen, ArrowLeft, ArrowRight
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ResponsiveContainer
} from "recharts";
import { storageGet, storageSet } from "./lib/storage.js";
import { supabase } from "./lib/supabaseClient.js";
import {
  listarAnalisesLaboratorio,
  criarAnaliseLaboratorio,
  listarAnalisesLaboratorioAdmin,
  conferirAnaliseLaboratorio,
} from "./lib/laboratorio.js";

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
const fmtBR = (v) =>
  num(v).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const valorFrete = volumeLiquido * frete;
  const custoMercadoria = valorProduto + valorFrete;

  // Tributos: cada um é uma alíquota em %, aplicada sobre o Volume Líquido (L).
  const icms = volumeLiquido * (num(row.icms) / 100);
  const pis = volumeLiquido * (num(row.pis) / 100);
  const cofins = volumeLiquido * (num(row.cofins) / 100);
  const cide = volumeLiquido * num(row.cide);
  const totalTributos = icms + pis + cofins + cide;

  const valorTotal = custoMercadoria + totalTributos;
  const tp = tempoPatio(row.chegada, row.saida);

  const veic = veiculos.find(
    (v) => v.placa.trim().toUpperCase() === (row.placa || "").trim().toUpperCase()
  );
  const placaCadastrada = !!veic;
  const transportadora = row.placa ? (veic ? veic.transportadora : "PLACA NÃO CADASTRADA") : "";

  return {
    pesoLiquido, volumeComBSW, bswL, volumeLiquido, divergencia, divergenciaAlta,
    valorProduto, valorFrete, custoMercadoria, icms, pis, cofins, cide, totalTributos,
    valorTotal, tempoMin: tp, transportadora, placaCadastrada, unidadeDivergencia: unidade,
  };
}


function normalizarDataRelatorio(value) {
  if (!value) return "—";
  const p = String(value).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(value);
}

function formatarNumeroRelatorio(value, casas = 2) {
  return num(value).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function formatarMoedaRelatorio(value) {
  return num(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function filtrarCargasRelatorio(cargas, periodo) {
  return (cargas || []).filter((c) => {
    const data = String(c.data || "");

    if (periodo.modo === "mes") {
      return periodo.mes ? data.startsWith(periodo.mes) : true;
    }

    if (periodo.modo === "intervalo") {
      if (periodo.inicio && data < periodo.inicio) return false;
      if (periodo.fim && data > periodo.fim) return false;
    }

    return true;
  });
}

function montarResumoRelatorio(registros, veiculos, config) {
  const resumo = {
    quantidade: registros.length,
    volumeOfertado: 0,
    pesoBruto: 0,
    pesoLiquido: 0,
    volumeLiquido: 0,
    valorFrete: 0,
    tributos: 0,
    valorTotal: 0,
    divergenciaTotal: 0,
    alertasDivergencia: 0,
    fornecedores: new Set(),
    motoristas: new Set(),
    veiculos: new Set(),
    produtos: new Map(),
  };

  registros.forEach((row) => {
    const calc = computeCarga(row, veiculos, config);

    resumo.volumeOfertado += num(row.ofertado);
    resumo.pesoBruto += num(row.pesoBruto);
    resumo.pesoLiquido += calc.pesoLiquido;
    resumo.volumeLiquido += calc.volumeLiquido;
    resumo.valorFrete += calc.valorFrete;
    resumo.tributos += calc.totalTributos;
    resumo.valorTotal += calc.valorTotal;
    resumo.divergenciaTotal += calc.divergencia;
    if (calc.divergenciaAlta) resumo.alertasDivergencia += 1;

    if (row.fornecedor) resumo.fornecedores.add(row.fornecedor);
    if (row.motorista) resumo.motoristas.add(row.motorista);
    if (row.placa) resumo.veiculos.add(row.placa);

    const produto = row.produto || "Não informado";
    resumo.produtos.set(produto, (resumo.produtos.get(produto) || 0) + 1);
  });

  return resumo;
}

function montarSecaoCargasRelatorio(titulo, registros, cadastros, config) {
  const linha = "=".repeat(76);
  const sublinha = "-".repeat(76);

  if (!registros.length) {
    return [
      linha,
      titulo,
      linha,
      "",
      "Nenhum registro encontrado para o período selecionado.",
      "",
    ].join("\n");
  }

  const blocos = registros.map((row, index) => {
    const calc = computeCarga(row, cadastros.veiculos, config);
    const fornecedorCadastro = cadastros.fornecedores.find(
      (f) => f.nome === row.fornecedor
    );
    const cnpj = row.cnpj || fornecedorCadastro?.cnpj || "—";

    return [
      `REGISTRO ${String(index + 1).padStart(3, "0")}`,
      sublinha,
      "",
      `Data: ${normalizarDataRelatorio(row.data)}`,
      `Tipo: ${titulo.includes("SAÍDA") ? "Saída" : "Entrada"}`,
      `Placa: ${row.placa || "—"}`,
      `Motorista: ${row.motorista || "—"}`,
      `Fornecedor: ${row.fornecedor || "—"}`,
      `CNPJ: ${cnpj}`,
      `Nota Fiscal: ${row.notaFiscal || "—"}`,
      `Produto: ${row.produto || "—"}`,
      `Tanque: ${row.tanque || "—"}`,
      `Status: ${row.status || "—"}`,
      "",
      "DADOS OPERACIONAIS",
      "",
      `Chegada: ${row.chegada || "—"}`,
      `Saída: ${row.saida || "—"}`,
      `Tempo de pátio: ${fmtMins(calc.tempoMin)}`,
      `Volume ofertado: ${formatarNumeroRelatorio(row.ofertado)} L`,
      `Peso bruto: ${formatarNumeroRelatorio(row.pesoBruto)} kg`,
      `Drenagem de água: ${formatarNumeroRelatorio(row.drenagem)} L`,
      `Tara: ${formatarNumeroRelatorio(row.tara)} kg`,
      `Peso líquido calculado: ${formatarNumeroRelatorio(calc.pesoLiquido)} kg`,
      "",
      "DADOS DE QUALIDADE / MEDIÇÃO",
      "",
      `API: ${row.api || "—"}`,
      `Densidade a 20 °C: ${row.densidade || "—"}`,
      `BS&W: ${row.bsw || "0"}%`,
      `Volume com BS&W: ${formatarNumeroRelatorio(calc.volumeComBSW)} L`,
      `BS&W calculado: ${formatarNumeroRelatorio(calc.bswL)} L`,
      `Volume líquido: ${formatarNumeroRelatorio(calc.volumeLiquido)} L`,
      `Divergência: ${formatarNumeroRelatorio(calc.divergencia)} ${calc.unidadeDivergencia}${calc.divergenciaAlta ? "  [ALERTA]" : ""}`,
      "",
      "DADOS FINANCEIROS",
      "",
      `Custo unitário: ${row.custoUnit ? formatarMoedaRelatorio(row.custoUnit) + "/L" : "—"}`,
      `Frete unitário: ${row.frete ? formatarMoedaRelatorio(row.frete) + "/L" : "—"}`,
      `Valor do produto calculado: ${formatarMoedaRelatorio(calc.valorProduto)}`,
      `Valor do frete calculado: ${formatarMoedaRelatorio(calc.valorFrete)}`,
      `ICMS calculado: ${formatarMoedaRelatorio(calc.icms)}`,
      `PIS calculado: ${formatarMoedaRelatorio(calc.pis)}`,
      `COFINS calculado: ${formatarMoedaRelatorio(calc.cofins)}`,
      titulo.includes("SAÍDA")
        ? `CIDE calculada: ${formatarMoedaRelatorio(calc.cide)}`
        : null,
      `Total de tributos calculados: ${formatarMoedaRelatorio(calc.totalTributos)}`,
      `Valor total calculado: ${formatarMoedaRelatorio(calc.valorTotal)}`,
      row.observacoes ? `Observações: ${row.observacoes}` : null,
      "",
    ].filter(Boolean).join("\n");
  });

  return [
    linha,
    titulo,
    linha,
    "",
    ...blocos,
  ].join("\n");
}

function montarResumoDescritivoRelatorio(entradas, saidas, cadastros, config) {
  const todos = [...entradas, ...saidas];
  const rEntrada = montarResumoRelatorio(entradas, cadastros.veiculos, config);
  const rSaida = montarResumoRelatorio(saidas, cadastros.veiculos, config);
  const rGeral = montarResumoRelatorio(todos, cadastros.veiculos, config);

  const produtos = Array.from(rGeral.produtos.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([produto, qtd]) => `- ${produto}: ${qtd} carga${qtd === 1 ? "" : "s"}`)
    .join("\n") || "- Nenhum produto registrado";

  const partes = [];

  if (entradas.length && saidas.length) {
    partes.push(
      `No período analisado foram registradas ${rGeral.quantidade} movimentações no SCRC, sendo ${rEntrada.quantidade} entrada${rEntrada.quantidade === 1 ? "" : "s"} e ${rSaida.quantidade} saída${rSaida.quantidade === 1 ? "" : "s"}.`
    );
  } else if (entradas.length) {
    partes.push(
      `No período analisado foram registradas ${rEntrada.quantidade} carga${rEntrada.quantidade === 1 ? "" : "s"} de entrada no SCRC.`
    );
  } else if (saidas.length) {
    partes.push(
      `No período analisado foram registradas ${rSaida.quantidade} carga${rSaida.quantidade === 1 ? "" : "s"} de saída no SCRC.`
    );
  } else {
    partes.push("Não foram encontradas movimentações para o período selecionado.");
  }

  if (todos.length) {
    partes.push(
      `O volume líquido consolidado foi de ${formatarNumeroRelatorio(rGeral.volumeLiquido)} L, com peso líquido calculado de ${formatarNumeroRelatorio(rGeral.pesoLiquido)} kg.`
    );

    partes.push(
      `Foram identificados ${rGeral.fornecedores.size} fornecedor${rGeral.fornecedores.size === 1 ? "" : "es"}, ${rGeral.motoristas.size} motorista${rGeral.motoristas.size === 1 ? "" : "s"} e ${rGeral.veiculos.size} veículo/conjunto${rGeral.veiculos.size === 1 ? "" : "s"} distintos.`
    );

    if (rGeral.alertasDivergencia > 0) {
      partes.push(
        `Existem ${rGeral.alertasDivergencia} registro${rGeral.alertasDivergencia === 1 ? "" : "s"} com divergência acima do limite configurado e que merecem conferência.`
      );
    } else {
      partes.push(
        "Nenhum registro do período apresentou alerta de divergência acima do limite configurado."
      );
    }
  }

  return {
    rEntrada,
    rSaida,
    rGeral,
    produtos,
    texto: partes.join("\n\n"),
  };
}

function gerarConteudoRelatorioTxt({
  cargasEntrada,
  cargasSaida,
  cadastros,
  config,
  tipo,
  periodo,
}) {
  const entradas =
    tipo === "saida" ? [] : filtrarCargasRelatorio(cargasEntrada, periodo);
  const saidas =
    tipo === "entrada" ? [] : filtrarCargasRelatorio(cargasSaida, periodo);

  const resumo = montarResumoDescritivoRelatorio(
    entradas,
    saidas,
    cadastros,
    config
  );

  const agora = new Date();
  const dataGeracao = agora.toLocaleDateString("pt-BR");
  const horaGeracao = agora.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  let periodoTexto = "Todos os registros";
  if (periodo.modo === "mes" && periodo.mes) {
    const [ano, mes] = periodo.mes.split("-");
    periodoTexto = `${mes}/${ano}`;
  } else if (periodo.modo === "intervalo") {
    const inicioTexto = periodo.inicio
      ? normalizarDataRelatorio(periodo.inicio)
      : "sem data inicial";
    const fimTexto = periodo.fim
      ? normalizarDataRelatorio(periodo.fim)
      : "sem data final";
    periodoTexto = `${inicioTexto} até ${fimTexto}`;
  }

  const linha = "=".repeat(76);
  const secoes = [];

  if (tipo !== "saida") {
    secoes.push(
      montarSecaoCargasRelatorio(
        "CARGAS DE ENTRADA",
        entradas,
        cadastros,
        config
      )
    );
  }

  if (tipo !== "entrada") {
    secoes.push(
      montarSecaoCargasRelatorio(
        "CARGAS DE SAÍDA",
        saidas,
        cadastros,
        config
      )
    );
  }

  const resumoTipo = (titulo, r) => [
    titulo,
    "-".repeat(76),
    "",
    `Quantidade de cargas: ${r.quantidade}`,
    `Volume ofertado: ${formatarNumeroRelatorio(r.volumeOfertado)} L`,
    `Volume líquido calculado: ${formatarNumeroRelatorio(r.volumeLiquido)} L`,
    `Peso bruto: ${formatarNumeroRelatorio(r.pesoBruto)} kg`,
    `Peso líquido calculado: ${formatarNumeroRelatorio(r.pesoLiquido)} kg`,
    `Divergência acumulada: ${formatarNumeroRelatorio(r.divergenciaTotal)} ${config?.unidadeDivergencia || "L"}`,
    `Valor de frete calculado: ${formatarMoedaRelatorio(r.valorFrete)}`,
    `Tributos calculados: ${formatarMoedaRelatorio(r.tributos)}`,
    `Valor total calculado: ${formatarMoedaRelatorio(r.valorTotal)}`,
    `Alertas de divergência: ${r.alertasDivergencia}`,
    "",
  ].join("\n");

  const resumosSeparados = [];

  if (tipo !== "saida") {
    resumosSeparados.push(
      resumoTipo("RESUMO DAS ENTRADAS", resumo.rEntrada)
    );
  }

  if (tipo !== "entrada") {
    resumosSeparados.push(
      resumoTipo("RESUMO DAS SAÍDAS", resumo.rSaida)
    );
  }

  const tituloResumoGeral =
    tipo === "ambos" ? "RESUMO CONSOLIDADO" : "RESUMO GERAL";

  return [
    linha,
    "SCRC - SISTEMA DE CONTROLE DE RECEBIMENTO DE CARGAS",
    "RELATÓRIO DE MOVIMENTAÇÃO",
    linha,
    "",
    `Gerado em: ${dataGeracao} às ${horaGeracao}`,
    `Período analisado: ${periodoTexto}`,
    `Movimentações: ${
      tipo === "ambos"
        ? "Entradas e Saídas"
        : tipo === "entrada"
          ? "Entradas"
          : "Saídas"
    }`,
    "",
    ...secoes,
    "",

    linha,
    "RESUMO POR TIPO DE MOVIMENTAÇÃO",
    linha,
    "",
    "",
    ...resumosSeparados,

    linha,
    tituloResumoGeral,
    linha,
    "",
    "",
    `Total de cargas de entrada: ${resumo.rEntrada.quantidade}`,
    `Total de cargas de saída: ${resumo.rSaida.quantidade}`,
    `Total de movimentações: ${resumo.rGeral.quantidade}`,
    "",
    `Volume ofertado consolidado: ${formatarNumeroRelatorio(resumo.rGeral.volumeOfertado)} L`,
    `Volume líquido consolidado: ${formatarNumeroRelatorio(resumo.rGeral.volumeLiquido)} L`,
    `Peso bruto consolidado: ${formatarNumeroRelatorio(resumo.rGeral.pesoBruto)} kg`,
    `Peso líquido consolidado: ${formatarNumeroRelatorio(resumo.rGeral.pesoLiquido)} kg`,
    `Divergência consolidada: ${formatarNumeroRelatorio(resumo.rGeral.divergenciaTotal)} ${config?.unidadeDivergencia || "L"}`,
    `Valor de frete consolidado: ${formatarMoedaRelatorio(resumo.rGeral.valorFrete)}`,
    `Tributos consolidados: ${formatarMoedaRelatorio(resumo.rGeral.tributos)}`,
    `Valor total consolidado: ${formatarMoedaRelatorio(resumo.rGeral.valorTotal)}`,
    `Alertas de divergência: ${resumo.rGeral.alertasDivergencia}`,
    "",
    "PRODUTOS MOVIMENTADOS",
    "",
    resumo.produtos,
    "",
    linha,
    "RESUMO DESCRITIVO",
    linha,
    "",
    resumo.texto,
    "",
    linha,
    "OBSERVAÇÃO SOBRE AS UNIDADES",
    linha,
    "",
    "Pesos são apresentados em kg.",
    "Volumes são apresentados em L.",
    `A divergência segue a unidade configurada no SCRC: ${config?.unidadeDivergencia || "L"}.`,
    "",
    linha,
    "FIM DO RELATÓRIO",
    linha,
    "",
  ].join("\n");
}

function baixarRelatorioTxt(conteudo, tipo) {
  const agora = new Date();
  const dataArquivo = [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, "0"),
    String(agora.getDate()).padStart(2, "0"),
  ].join("-");

  const tipoArquivo = tipo === "ambos" ? "CONSOLIDADO" : tipo.toUpperCase();
  const nome = `RELATORIO_SCRC_${tipoArquivo}_${dataArquivo}.txt`;
  const blob = new Blob(["\uFEFF", conteudo], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const STATUS_OPTIONS = ["PENDENTE", "RECEBIDO", "EM ANÁLISE", "CANCELADO"];
const STATUS_SAIDA = "ENVIADO";

const ADMIN_INACTIVITY_MS = 15 * 60 * 1000; // 15 minutos
const ADMIN_LAST_ACTIVITY_KEY = "scrc_admin_last_activity";
const SCRC_GUIDE_VERSION = "v1";


const STATUS_STYLE = {
  PENDENTE: { fg: C.yellow, bg: C.yellowBg },
  ENVIADO: { fg: C.green, bg: C.greenBg },
  "RECEBIDO": { fg: C.green, bg: C.greenBg },
  CANCELADO: { fg: C.red, bg: C.redBg },
  "EM ANÁLISE": { fg: C.steel, bg: "#1B2530" },
};

const emptyForm = {
  data: "", chegada: "", saida: "", placa: "", motorista: "", notaFiscal: "", fornecedor: "", produto: "",
  api: "", ofertado: "", pesoBruto: "", drenagem: "0", tara: "", densidade: "",
  bsw: "", tanque: "", custoUnit: "", frete: "", icms: "0", pis: "0", cofins: "0", cide: "0", status: "PENDENTE",
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
  const [cargasSaida, setCargasSaida] = useState([]);
  const [cadastros, setCadastros] = useState(SEED_CADASTROS);
  const [config, setConfig] = useState(SEED_CONFIG);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLaboratorio, setIsLaboratorio] = useState(false);

  const [showLogin, setShowLogin] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const [adminProfile, setAdminProfile] = useState("");
  const [laboratorioProfile, setLaboratorioProfile] = useState("");
  const adminInactivityTimerRef = useRef(null);
  const adminLastActivityRef = useRef(Date.now());
  const adminAutoLogoutRunningRef = useRef(false);

  const showToast = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), kind === "err" ? 8000 : 2600);
  }, []);

  const getAdminProfile = useCallback(async (userId) => {
    const { data: profile, error } = await supabase
      .from("scrc_admins")
      .select("perfil, ativo")
      .eq("user_id", userId)
      .eq("ativo", true)
      .maybeSingle();

    if (error) {
      console.error("Erro ao consultar perfil administrativo:", error);
      return null;
    }

    return profile?.ativo && profile?.perfil ? profile : null;
  }, []);

  const getLaboratorioProfile = useCallback(async (userId) => {
    const { data: profile, error } = await supabase
      .from("scrc_laboratorio_usuarios")
      .select("perfil, ativo")
      .eq("user_id", userId)
      .eq("ativo", true)
      .maybeSingle();

    if (error) {
      console.error("Erro ao consultar perfil do Laboratório:", error);
      return null;
    }

    return profile?.ativo && profile?.perfil ? profile : null;
  }, []);

  const syncRestrictedSession = useCallback(async (session) => {
    const user = session?.user;

    if (!user) {
      setIsAdmin(false);
      setIsLaboratorio(false);
      setAdminProfile("");
      setLaboratorioProfile("");
      setAuthReady(true);
      return false;
    }

    const [adminProfileResult, laboratorioProfileResult] = await Promise.all([
      getAdminProfile(user.id),
      getLaboratorioProfile(user.id),
    ]);

    const accessType = adminProfileResult
      ? "admin"
      : laboratorioProfileResult
        ? "laboratorio"
        : null;

    if (!accessType) {
      setIsAdmin(false);
      setIsLaboratorio(false);
      setAdminProfile("");
      setLaboratorioProfile("");
      setAuthReady(true);
      return false;
    }

    const { data: aal, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      console.error("Erro ao verificar nível MFA:", aalError);
      setIsAdmin(false);
      setIsLaboratorio(false);
      setAdminProfile("");
      setLaboratorioProfile("");
      setAuthReady(true);
      return false;
    }

    const mfaValidado = aal?.currentLevel === "aal2";

    setIsAdmin(mfaValidado && accessType === "admin");
    setIsLaboratorio(mfaValidado && accessType === "laboratorio");
    setAdminProfile(
      mfaValidado && accessType === "admin"
        ? adminProfileResult.perfil
        : ""
    );
    setLaboratorioProfile(
      mfaValidado && accessType === "laboratorio"
        ? laboratorioProfileResult.perfil
        : ""
    );
    setAuthReady(true);

    return mfaValidado;
  }, [getAdminProfile, getLaboratorioProfile]);

  // Mantém o acesso restrito sincronizado com a sessão real do Supabase Auth.
  // Reconhece Administrador ou Laboratório, sempre com MFA/AAL2.
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;
      if (error) {
        console.error("Erro ao recuperar sessão do Supabase:", error);
        setAuthReady(true);
        return;
      }
      await syncRestrictedSession(data?.session || null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      void syncRestrictedSession(session);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [syncRestrictedSession]);

  const handleRestrictedLogin = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) throw error;

    const user = data?.user || data?.session?.user;

    const [adminProfileResult, laboratorioProfileResult] = user
      ? await Promise.all([
          getAdminProfile(user.id),
          getLaboratorioProfile(user.id),
        ])
      : [null, null];

    const accessProfile = adminProfileResult || laboratorioProfileResult;
    const accessType = adminProfileResult
      ? "admin"
      : laboratorioProfileResult
        ? "laboratorio"
        : null;

    if (!accessProfile || !accessType) {
      await supabase.auth.signOut();
      const accessError = new Error(
        "Usuário autenticado, mas sem perfil ativo de Administrador ou Laboratório no SCRC."
      );
      accessError.code = "SCRC_RESTRICTED_NOT_AUTHORIZED";
      throw accessError;
    }

    const { data: factors, error: factorsError } =
      await supabase.auth.mfa.listFactors();

    if (factorsError) throw factorsError;

    const verifiedTotp = factors?.totp?.find(
      (factor) => factor.status === "verified"
    );

    if (verifiedTotp) {
      return {
        step: "verify",
        factorId: verifiedTotp.id,
        profile: accessProfile.perfil,
        accessType,
      };
    }

    const pendingTotp =
      factors?.totp?.filter((factor) => factor.status !== "verified") || [];

    for (const factor of pendingTotp) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      } catch (_) {}
    }

    const { data: enrollment, error: enrollError } =
      await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `SCRC - ${accessProfile.perfil}`,
      });

    if (enrollError) throw enrollError;

    return {
      step: "enroll",
      factorId: enrollment.id,
      qrCode: enrollment.totp?.qr_code || "",
      secret: enrollment.totp?.secret || "",
      profile: accessProfile.perfil,
      accessType,
    };
  }, [getAdminProfile, getLaboratorioProfile]);

  const handleMfaVerify = useCallback(async (factorId, code) => {
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) throw verifyError;

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    const autorizado = await syncRestrictedSession(sessionData?.session || null);
    if (!autorizado) {
      const mfaError = new Error("O segundo fator não elevou a sessão restrita para AAL2.");
      mfaError.code = "SCRC_MFA_NOT_COMPLETED";
      throw mfaError;
    }
  }, [syncRestrictedSession]);

  const handleLoginCancel = useCallback(async () => {
    if (!isAdmin && !isLaboratorio) {
      try { await supabase.auth.signOut(); } catch (_) {}
      setAdminProfile("");
      setLaboratorioProfile("");
    }
  }, [isAdmin, isLaboratorio]);

  const handleRestrictedLogout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast("Não foi possível encerrar a sessão.", "err");
      console.error("Erro ao sair do Supabase Auth:", error);
      return;
    }

    try { localStorage.removeItem(ADMIN_LAST_ACTIVITY_KEY); } catch (_) {}

    setIsAdmin(false);
    setIsLaboratorio(false);
    setAdminProfile("");
    setLaboratorioProfile("");
    setShowLogin(false);
    setTab("historico");
    showToast("Sessão encerrada.");
  }, [showToast]);


  // Encerra automaticamente o Modo Admin após 15 minutos sem interação.
  // O visitante continua podendo usar as áreas de consulta normalmente.
  useEffect(() => {
    if (!isAdmin && !isLaboratorio) {
      if (adminInactivityTimerRef.current) {
        clearTimeout(adminInactivityTimerRef.current);
        adminInactivityTimerRef.current = null;
      }
      adminAutoLogoutRunningRef.current = false;
      return;
    }

    const autoLogout = async () => {
      if (adminAutoLogoutRunningRef.current) return;
      adminAutoLogoutRunningRef.current = true;

      try {
        await supabase.auth.signOut();
      } catch (error) {
        console.error("Erro ao encerrar sessão administrativa por inatividade:", error);
      } finally {
        try { localStorage.removeItem(ADMIN_LAST_ACTIVITY_KEY); } catch (_) {}
        setIsAdmin(false);
        setIsLaboratorio(false);
        setAdminProfile("");
        setLaboratorioProfile("");
        setShowLogin(false);
        setTab("historico");
        showToast("Sessão restrita encerrada automaticamente após 15 minutos de inatividade.");
        adminAutoLogoutRunningRef.current = false;
      }
    };

    const scheduleTimeout = () => {
      if (adminInactivityTimerRef.current) clearTimeout(adminInactivityTimerRef.current);

      const elapsed = Date.now() - adminLastActivityRef.current;
      const remaining = Math.max(0, ADMIN_INACTIVITY_MS - elapsed);

      adminInactivityTimerRef.current = setTimeout(autoLogout, remaining);
    };

    const registerActivity = () => {
      const now = Date.now();
      adminLastActivityRef.current = now;
      try { localStorage.setItem(ADMIN_LAST_ACTIVITY_KEY, String(now)); } catch (_) {}
      scheduleTimeout();
    };

    const checkElapsedTime = () => {
      if (Date.now() - adminLastActivityRef.current >= ADMIN_INACTIVITY_MS) {
        void autoLogout();
      } else {
        scheduleTimeout();
      }
    };

    let storedLastActivity = 0;
    try { storedLastActivity = Number(localStorage.getItem(ADMIN_LAST_ACTIVITY_KEY) || 0); } catch (_) {}

    if (Number.isFinite(storedLastActivity) && storedLastActivity > 0) {
      adminLastActivityRef.current = storedLastActivity;
    } else {
      adminLastActivityRef.current = Date.now();
      try { localStorage.setItem(ADMIN_LAST_ACTIVITY_KEY, String(adminLastActivityRef.current)); } catch (_) {}
    }

    checkElapsedTime();

    const activityEvents = ["pointerdown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, registerActivity, { passive: true })
    );
    window.addEventListener("focus", checkElapsedTime);
    document.addEventListener("visibilitychange", checkElapsedTime);

    return () => {
      if (adminInactivityTimerRef.current) {
        clearTimeout(adminInactivityTimerRef.current);
        adminInactivityTimerRef.current = null;
      }
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, registerActivity)
      );
      window.removeEventListener("focus", checkElapsedTime);
      document.removeEventListener("visibilitychange", checkElapsedTime);
    };
  }, [isAdmin, isLaboratorio, showToast]);

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
        const cSaida = await storageGet("scrc_cargas_saida");
        if (cSaida && cSaida.value) setCargasSaida(JSON.parse(cSaida.value));
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

  const persistCargasSaida = useCallback(async (next) => {
    setCargasSaida(next);
    try {
      await storageSet("scrc_cargas_saida", JSON.stringify(next));
    } catch (e) { showToast("Não consegui salvar a carga de saída: " + (e?.message || "erro desconhecido") + (e?.hint ? " — " + e.hint : ""), "err"); console.error("Erro ao salvar carga de saída:", e); }
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

  const guideMode = isLaboratorio
    ? "laboratorio"
    : isAdmin
      ? "admin"
      : "visitante";

  const guideStorageKey = `scrc_guia_${SCRC_GUIDE_VERSION}_${guideMode}`;

  useEffect(() => {
    if (!authReady || loading) return;

    try {
      const jaVisualizado = localStorage.getItem(guideStorageKey) === "1";
      if (!jaVisualizado) {
        setShowGuide(true);
      }
    } catch (_) {
      // Se o navegador bloquear o localStorage, o botão manual continua disponível.
    }
  }, [authReady, loading, guideStorageKey]);

  const fecharGuia = useCallback(() => {
    try {
      localStorage.setItem(guideStorageKey, "1");
    } catch (_) {}
    setShowGuide(false);
  }, [guideStorageKey]);

  const TABS = isLaboratorio
    ? []
    : [
        { id: "lancar", label: "Lançar Entrada", icon: Plus },
        { id: "lancar_saida", label: "Lançar Saída", icon: Truck },
        { id: "historico", label: "Histórico", icon: ClipboardList },
        { id: "painel", label: "Painel Resumo", icon: LayoutDashboard },
        { id: "cadastros", label: "Cadastros", icon: Warehouse },
        ...(isAdmin
          ? [
              { id: "laboratorio_admin", label: "Laboratório", icon: Gauge },
              { id: "config", label: "Configurações", icon: Settings },
            ]
          : []),
      ];

  if (loading || !authReady) {
    return (
      <div style={{
        background: C.bg, minHeight: 480, display: "flex", alignItems: "center",
        justifyContent: "center", color: C.textDim, fontFamily: MONO, fontSize: 13,
      }}>
        carregando dados e sessão…
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

          <button
            onClick={() => setShowGuide(true)}
            title="Abrir o guia rápido do SCRC"
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "transparent",
              border: `1px solid ${C.border}`, borderRadius: 4, color: C.textDim,
              padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              textTransform: "uppercase", letterSpacing: "0.03em",
            }}
          >
            <HelpCircle size={13} color={C.accent} /> Como usar
          </button>

          {isAdmin ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pill text="Modo admin" fg={C.accent} bg={`${C.accentDim}33`} />
              {adminProfile && (
                <div
                  title={`Perfil administrativo: ${adminProfile}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 4,
                    color: C.textDim, padding: "7px 10px", fontSize: 11.5, fontWeight: 600,
                    maxWidth: 300,
                  }}
                >
                  <Users size={13} color={C.accent} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {adminProfile}
                  </span>
                </div>
              )}
              <button onClick={handleRestrictedLogout}
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
          ) : isLaboratorio ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pill text="Modo laboratório" fg={C.steel} bg="#1B2530" />
              {laboratorioProfile && (
                <div
                  title={`Perfil: ${laboratorioProfile}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 4,
                    color: C.textDim, padding: "7px 10px", fontSize: 11.5, fontWeight: 600,
                    maxWidth: 300,
                  }}
                >
                  <Users size={13} color={C.steel} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {laboratorioProfile}
                  </span>
                </div>
              )}
              <button onClick={handleRestrictedLogout}
                title="Sair do modo laboratório"
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
                <Lock size={13} /> Acesso restrito
              </button>
            </div>
          )}
        </div>
      </div>

      {showGuide && (
        <GuiaUsoModal
          mode={guideMode}
          currentTab={tab}
          onClose={fecharGuia}
        />
      )}

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onCancel={handleLoginCancel}
          onSubmit={handleRestrictedLogin}
          onVerify={async (factorId, code) => {
            await handleMfaVerify(factorId, code);
            setShowLogin(false);
            showToast(
              isLaboratorio
                ? "Modo laboratório ativado com senha + MFA."
                : "Modo admin ativado com senha + MFA."
            );
          }}
        />
      )}

      {/* CONTENT */}
      <div style={{ padding: 24 }}>
        {isLaboratorio ? (
          <LaboratorioModulo
            cadastros={cadastros}
            onToast={showToast}
          />
        ) : (
          <>
        {tab === "lancar" && (
          isAdmin ? (
            <LancarCarga
              cadastros={cadastros}
              config={config}
              tipo="entrada"
              onSave={(row) => {
                persistCargas([...cargas, { ...row, id: uid(), movimento: "ENTRADA" }]);
                showToast("Carga de entrada registrada.");
              }}
            />
          ) : <ReadOnlyNotice onEnter={() => setShowLogin(true)} text="Somente administradores podem lançar cargas." />
        )}
        {tab === "lancar_saida" && (
          isAdmin ? (
            <LancarCarga
              cadastros={cadastros}
              config={config}
              tipo="saida"
              onSave={(row) => {
                persistCargasSaida([...cargasSaida, { ...row, id: uid(), movimento: "SAIDA" }]);
                showToast("Carga de saída registrada.");
              }}
            />
          ) : <ReadOnlyNotice onEnter={() => setShowLogin(true)} text="Somente administradores podem lançar cargas de saída." />
        )}
        {tab === "historico" && (
          <Historico
            cargasEntrada={cargas}
            cargasSaida={cargasSaida}
            cadastros={cadastros}
            config={config}
            isAdmin={isAdmin}
            onDeleteEntrada={(id) => { persistCargas(cargas.filter((c) => c.id !== id)); showToast("Carga de entrada excluída."); }}
            onUpdateEntrada={(row) => { persistCargas(cargas.map((c) => (c.id === row.id ? row : c))); showToast("Carga de entrada atualizada."); }}
            onDeleteSaida={(id) => { persistCargasSaida(cargasSaida.filter((c) => c.id !== id)); showToast("Carga de saída excluída."); }}
            onUpdateSaida={(row) => { persistCargasSaida(cargasSaida.map((c) => (c.id === row.id ? row : c))); showToast("Carga de saída atualizada."); }}
          />
        )}
        {tab === "painel" && <PainelResumo cargasEntrada={cargas} cargasSaida={cargasSaida} cadastros={cadastros} config={config} />}
        {tab === "cadastros" && (
          <Cadastros cadastros={cadastros} cargas={cargas} isAdmin={isAdmin} onSave={persistCadastros} config={config} />
        )}
        {tab === "laboratorio_admin" && isAdmin && (
          <LaboratorioAdminConsulta onToast={showToast} />
        )}
        {tab === "config" && isAdmin && (
          <Configuracoes config={config} cadastros={cadastros} onSave={(next) => { persistConfig(next); showToast("Configurações salvas."); }} />
        )}
          </>
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



function LaboratorioAdminConsulta({ onToast }) {
  const [analises, setAnalises] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [processandoId, setProcessandoId] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [query, setQuery] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await listarAnalisesLaboratorioAdmin();
      setAnalises(data);
    } catch (error) {
      console.error("Erro ao carregar análises para o Administrador:", error);
      onToast?.(
        "Não foi possível carregar as análises do Laboratório: " +
          (error?.message || "erro desconhecido"),
        "err"
      );
    } finally {
      setCarregando(false);
    }
  }, [onToast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();

    return analises.filter((a) => {
      if (filtroStatus === "disponivel" && a.conferido) return false;
      if (filtroStatus === "conferido" && !a.conferido) return false;

      if (!q) return true;

      return [
        a.tipo_movimento,
        a.data_referencia,
        a.placa,
        a.nota_fiscal,
        a.produto,
        a.temperatura,
        a.densidade,
        a.api,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ")
        .includes(q);
    });
  }, [analises, filtroStatus, query]);

  const alterarConferencia = async (analise) => {
    if (processandoId) return;

    setProcessandoId(analise.id);
    try {
      await conferirAnaliseLaboratorio(analise.id, !analise.conferido);

      setAnalises((atuais) =>
        atuais.map((item) =>
          item.id === analise.id
            ? { ...item, conferido: !analise.conferido }
            : item
        )
      );

      onToast?.(
        analise.conferido
          ? "Análise marcada novamente como disponível."
          : "Análise marcada como conferida."
      );
    } catch (error) {
      console.error("Erro ao alterar conferência:", error);
      onToast?.(
        "Não foi possível atualizar a conferência: " +
          (error?.message || "erro desconhecido"),
        "err"
      );
    } finally {
      setProcessandoId(null);
    }
  };

  const fmtData = (value) => {
    if (!value) return "—";
    const parts = String(value).split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  };

  const fmtDataHora = (value) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("pt-BR");
    } catch (_) {
      return value;
    }
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <SectionTitle
          eyebrow={`${analises.length} análise${analises.length === 1 ? "" : "s"} registrada${analises.length === 1 ? "" : "s"}`}
          title="Consulta do Laboratório"
        />
        <div
          style={{
            color: C.textDim,
            fontSize: 12.5,
            lineHeight: 1.55,
            marginTop: -8,
          }}
        >
          Dados laboratoriais somente para consulta. Temperatura, Densidade e API
          não são transferidos automaticamente para os lançamentos de carga.
        </div>
      </div>

      <Card style={{ padding: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 220px auto",
            gap: 10,
            alignItems: "end",
          }}
          className="scrc-grid"
        >
          <Field label="Pesquisar">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Placa, NF, produto, API, densidade..."
            />
          </Field>

          <Field label="Status">
            <Select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
            >
              <option value="todos">Todos</option>
              <option value="disponivel">Análise disponível</option>
              <option value="conferido">Conferido</option>
            </Select>
          </Field>

          <Btn variant="ghost" onClick={carregar}>
            <Search size={13} /> Atualizar
          </Btn>
        </div>
      </Card>

      {carregando ? (
        <Card>
          <div style={{ color: C.textDim, fontSize: 13 }}>
            carregando análises do Laboratório…
          </div>
        </Card>
      ) : filtradas.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "36px 20px" }}>
          <Droplets size={24} color={C.textFaint} style={{ marginBottom: 10 }} />
          <div style={{ color: C.textDim, fontSize: 13 }}>
            Nenhuma análise encontrada para os filtros informados.
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtradas.map((a) => (
            <Card key={a.id} style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: MONO,
                      color: C.accent,
                      fontSize: 11,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      marginBottom: 5,
                    }}
                  >
                    {a.tipo_movimento} • {fmtData(a.data_referencia)}
                  </div>

                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 19,
                      fontWeight: 800,
                      color: C.text,
                      textTransform: "uppercase",
                    }}
                  >
                    {a.placa || "Placa não informada"}
                  </div>

                  <div
                    style={{
                      color: C.textDim,
                      fontSize: 12.5,
                      marginTop: 4,
                    }}
                  >
                    NF: <strong style={{ color: C.text }}>{a.nota_fiscal || "—"}</strong>
                    {" • "}
                    Produto: <strong style={{ color: C.text }}>{a.produto || "—"}</strong>
                  </div>
                </div>

                <Pill
                  text={a.conferido ? "Conferido" : "Análise disponível"}
                  fg={a.conferido ? C.green : C.yellow}
                  bg={a.conferido ? C.greenBg : C.yellowBg}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                  gap: 10,
                  marginBottom: 14,
                }}
                className="scrc-grid"
              >
                {[
                  {
                    label: "Temperatura",
                    value: `${Number(a.temperatura).toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                    })} °C`,
                  },
                  {
                    label: "Densidade",
                    value: Number(a.densidade).toLocaleString("pt-BR", {
                      minimumFractionDigits: 3,
                      maximumFractionDigits: 4,
                    }),
                  },
                  {
                    label: "API",
                    value: Number(a.api).toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                    }),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      background: C.panelAlt,
                      border: `1px solid ${C.border}`,
                      borderRadius: 5,
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10.5,
                        color: C.textDim,
                        letterSpacing: ".07em",
                        textTransform: "uppercase",
                        marginBottom: 5,
                      }}
                    >
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 18,
                        fontWeight: 700,
                        color: C.text,
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  paddingTop: 12,
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontSize: 11.5, color: C.textFaint }}>
                  Registrado em: {fmtDataHora(a.created_at)}
                  {a.carga_id ? ` • Carga vinculada: ${a.carga_id}` : ""}
                </div>

                <Btn
                  variant="ghost"
                  onClick={() => alterarConferencia(a)}
                  disabled={processandoId === a.id}
                  style={{
                    opacity: processandoId === a.id ? 0.55 : 1,
                    pointerEvents: processandoId === a.id ? "none" : "auto",
                  }}
                >
                  <Check size={13} />
                  {processandoId === a.id
                    ? "Atualizando…"
                    : a.conferido
                      ? "Marcar como disponível"
                      : "Marcar como conferido"}
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LaboratorioModulo({ cadastros, onToast }) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    tipo_movimento: "ENTRADA",
    data_referencia: hoje,
    placa: "",
    nota_fiscal: "",
    produto: "Petróleo Bruto",
    temperatura: "",
    densidade: "",
    api: "",
  });

  const [analises, setAnalises] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const veiculosAtivos = useMemo(
    () => (cadastros?.veiculos || []).filter((v) => v.status === "ATIVO"),
    [cadastros]
  );

  const produtosAtivos = useMemo(
    () => (cadastros?.produtos || []).filter((p) => p.status === "ATIVO"),
    [cadastros]
  );

  const carregarAnalises = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await listarAnalisesLaboratorio();
      setAnalises(data);
    } catch (error) {
      console.error("Erro ao carregar análises laboratoriais:", error);
      onToast?.(
        "Não foi possível carregar o histórico do Laboratório: " +
          (error?.message || "erro desconhecido"),
        "err"
      );
    } finally {
      setCarregando(false);
    }
  }, [onToast]);

  useEffect(() => {
    void carregarAnalises();
  }, [carregarAnalises]);

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const camposValidos =
    form.tipo_movimento &&
    form.data_referencia &&
    form.placa.trim() &&
    form.produto.trim() &&
    String(form.temperatura).trim() &&
    String(form.densidade).trim() &&
    String(form.api).trim();

  const salvar = async () => {
    if (!camposValidos || salvando) return;

    setSalvando(true);
    try {
      await criarAnaliseLaboratorio({
        tipo_movimento: form.tipo_movimento,
        data_referencia: form.data_referencia,
        placa: form.placa.trim().toUpperCase(),
        nota_fiscal: form.nota_fiscal.trim() || null,
        produto: form.produto.trim(),
        temperatura: num(form.temperatura),
        densidade: num(form.densidade),
        api: num(form.api),
      });

      onToast?.("Análise laboratorial registrada com sucesso.");

      setForm((current) => ({
        ...current,
        nota_fiscal: "",
        temperatura: "",
        densidade: "",
        api: "",
      }));

      await carregarAnalises();
    } catch (error) {
      console.error("Erro ao registrar análise laboratorial:", error);
      onToast?.(
        "Não foi possível registrar a análise: " +
          (error?.message || "erro desconhecido"),
        "err"
      );
    } finally {
      setSalvando(false);
    }
  };

  const fmtDataHora = (value) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("pt-BR");
    } catch (_) {
      return value;
    }
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card>
        <SectionTitle
          eyebrow="Acesso exclusivo"
          title="Laboratório"
        />

        <div
          style={{
            background: "#1B2530",
            border: `1px solid ${C.steel}44`,
            borderRadius: 6,
            padding: "12px 14px",
            color: C.textDim,
            fontSize: 12.5,
            lineHeight: 1.55,
            marginBottom: 18,
          }}
        >
          Informe a carga de referência e os três resultados do Laboratório.
          Estes dados são apenas para consulta dos Administradores e não
          preenchem nem alteram automaticamente os lançamentos de Entrada ou Saída.
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              gap: 12,
            }}
            className="scrc-grid"
          >
            <Field label="Movimento" required>
              <Select
                value={form.tipo_movimento}
                onChange={set("tipo_movimento")}
              >
                <option value="ENTRADA">Entrada</option>
                <option value="SAIDA">Saída</option>
              </Select>
            </Field>

            <Field label="Data de referência" required>
              <Input
                type="date"
                value={form.data_referencia}
                onChange={set("data_referencia")}
              />
            </Field>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              gap: 12,
            }}
            className="scrc-grid"
          >
            <Field
              label="Placa / conjunto"
              required
              hint="Identificação da carga que receberá estes resultados."
            >
              {veiculosAtivos.length > 0 ? (
                <Select value={form.placa} onChange={set("placa")}>
                  <option value="">Selecione…</option>
                  {veiculosAtivos.map((v) => (
                    <option key={v.id} value={v.placa}>
                      {v.placa}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={form.placa}
                  onChange={set("placa")}
                  placeholder="Ex.: ABC1D23 / XYZ9A99"
                />
              )}
            </Field>

            <Field
              label="Nota fiscal"
              hint="Recomendado para facilitar a identificação da carga."
            >
              <Input
                value={form.nota_fiscal}
                onChange={set("nota_fiscal")}
                placeholder="NF-000"
              />
            </Field>
          </div>

          <Field label="Produto" required>
            {produtosAtivos.length > 0 ? (
              <Select value={form.produto} onChange={set("produto")}>
                <option value="">Selecione…</option>
                {produtosAtivos.map((p) => (
                  <option key={p.id} value={p.nome}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={form.produto}
                onChange={set("produto")}
                placeholder="Produto"
              />
            )}
          </Field>

          <div
            style={{
              marginTop: 4,
              paddingTop: 16,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: C.steel,
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              Resultados laboratoriais
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                gap: 12,
              }}
              className="scrc-grid"
            >
              <Field label="Temperatura (°C)" required>
                <Input
                  type="number"
                  step="0.01"
                  value={form.temperatura}
                  onChange={set("temperatura")}
                  placeholder="0,00"
                />
              </Field>

              <Field label="Densidade" required>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.densidade}
                  onChange={set("densidade")}
                  placeholder="0,0000"
                />
              </Field>

              <Field label="API" required>
                <Input
                  type="number"
                  step="0.01"
                  value={form.api}
                  onChange={set("api")}
                  placeholder="0,00"
                />
              </Field>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <Btn
              onClick={salvar}
              disabled={!camposValidos || salvando}
              style={{
                opacity: !camposValidos || salvando ? 0.55 : 1,
                pointerEvents: !camposValidos || salvando ? "none" : "auto",
              }}
            >
              <Save size={14} />
              {salvando ? "Salvando…" : "Registrar análise"}
            </Btn>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle
          eyebrow={`${analises.length} registro${analises.length === 1 ? "" : "s"}`}
          title="Análises registradas"
        />

        {carregando ? (
          <div style={{ color: C.textDim, fontSize: 13 }}>
            carregando análises…
          </div>
        ) : analises.length === 0 ? (
          <div
            style={{
              color: C.textDim,
              fontSize: 13,
              padding: "18px 0",
            }}
          >
            Nenhuma análise laboratorial registrada.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 960,
                fontSize: 12.5,
              }}
            >
              <thead>
                <tr>
                  {[
                    "Data",
                    "Movimento",
                    "Placa",
                    "NF",
                    "Produto",
                    "Temperatura",
                    "Densidade",
                    "API",
                    "Status",
                    "Registrado em",
                  ].map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: "left",
                        color: C.textDim,
                        background: C.panelAlt,
                        borderBottom: `1px solid ${C.border}`,
                        padding: "9px 10px",
                        fontSize: 10.5,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analises.map((a) => (
                  <tr key={a.id}>
                    <td style={labTd}>{a.data_referencia || "—"}</td>
                    <td style={labTd}>{a.tipo_movimento || "—"}</td>
                    <td style={{ ...labTd, fontFamily: MONO }}>{a.placa || "—"}</td>
                    <td style={labTd}>{a.nota_fiscal || "—"}</td>
                    <td style={labTd}>{a.produto || "—"}</td>
                    <td style={{ ...labTd, fontFamily: MONO }}>
                      {Number(a.temperatura).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} °C
                    </td>
                    <td style={{ ...labTd, fontFamily: MONO }}>
                      {Number(a.densidade).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}
                    </td>
                    <td style={{ ...labTd, fontFamily: MONO }}>
                      {Number(a.api).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                    </td>
                    <td style={labTd}>
                      <Pill
                        text={a.conferido ? "Conferido" : "Disponível"}
                        fg={a.conferido ? C.green : C.yellow}
                        bg={a.conferido ? C.greenBg : C.yellowBg}
                      />
                    </td>
                    <td style={{ ...labTd, whiteSpace: "nowrap" }}>
                      {fmtDataHora(a.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const labTd = {
  padding: "10px",
  borderBottom: `1px solid ${C.border}`,
  color: C.text,
  verticalAlign: "middle",
};


function GuiaUsoModal({ mode, currentTab, onClose }) {
  const [stepIndex, setStepIndex] = useState(0);

  const steps = useMemo(() => {
    if (mode === "laboratorio") {
      return [
        {
          title: "Bem-vindo ao Laboratório",
          icon: BookOpen,
          text:
            "O acesso do Laboratório é exclusivo para registrar e consultar os resultados de Temperatura, Densidade e API. As demais áreas administrativas permanecem bloqueadas.",
          tip:
            "Use sempre os dados que identificam corretamente a carga antes de registrar a análise.",
        },
        {
          title: "1. Identifique a carga",
          icon: Truck,
          text:
            "Informe o tipo de movimento, a data de referência, a placa/conjunto, a nota fiscal quando disponível e o produto. Esses dados ajudam o Administrador a localizar a análise correta.",
          tip:
            "Placa, data, produto e nota fiscal tornam a correspondência mais segura.",
        },
        {
          title: "2. Informe os resultados",
          icon: Gauge,
          text:
            "Preencha Temperatura, Densidade e API com os valores obtidos pelo Laboratório. Confira os três campos antes de registrar.",
          tip:
            "Esses valores servem como referência para o lançamento da carga e não alteram os lançamentos automaticamente.",
        },
        {
          title: "3. Registre e consulte",
          icon: Save,
          text:
            "Clique em Registrar análise. Depois, use a relação de análises registradas para confirmar que o envio foi salvo corretamente.",
          tip:
            "Se houver dúvida sobre a identificação da carga, confirme antes de criar um novo registro.",
        },
        {
          title: "4. Finalize o acesso",
          icon: Unlock,
          text:
            "Ao terminar o trabalho, clique em Sair. O SCRC também encerra automaticamente sessões restritas após o período configurado de inatividade.",
          tip:
            "Não compartilhe sua sessão autenticada com outras pessoas.",
        },
      ];
    }

    if (mode === "admin") {
      return [
        {
          title: "Bem-vindo ao SCRC",
          icon: BookOpen,
          text:
            "Este guia apresenta o fluxo básico de trabalho do Sistema de Controle de Recebimento de Cargas. Você pode voltar a este passo a passo a qualquer momento pelo botão Como usar.",
          tip:
            "A ordem mais comum é: cadastrar referências → lançar carga → consultar histórico e painel.",
        },
        {
          title: "1. Lançar Entrada",
          icon: Plus,
          text:
            "Use Lançar Entrada quando uma carga chegar à unidade. Preencha a identificação, os dados operacionais, qualidade/medição e os valores necessários. Confira a Prévia antes de registrar.",
          tip:
            "A área Referência do Laboratório é somente para consulta. API e Densidade continuam sendo digitadas manualmente.",
        },
        {
          title: "2. Lançar Saída",
          icon: Truck,
          text:
            "Use Lançar Saída para registrar cargas expedidas. O preenchimento é semelhante ao de Entrada, com as regras específicas da saída já aplicadas pelo SCRC.",
          tip:
            "O status de saída é controlado pelo próprio fluxo do sistema.",
        },
        {
          title: "3. Histórico",
          icon: ClipboardList,
          text:
            "No Histórico você consulta as cargas de Entrada e Saída, pesquisa por informações importantes, filtra por mês e, quando autorizado, edita registros.",
          tip:
            "O botão Gerar Relatório permite exportar Entrada, Saída ou um relatório consolidado em formato TXT.",
        },
        {
          title: "4. Painel Resumo",
          icon: LayoutDashboard,
          text:
            "Use o Painel Resumo para acompanhar os principais totais, divergências, valores e comparativos das movimentações registradas.",
          tip:
            "Alterne entre Entradas, Saídas e Consolidado para comparar os resultados.",
        },
        {
          title: "5. Cadastros",
          icon: Warehouse,
          text:
            "Cadastre e mantenha fornecedores, motoristas, veículos, produtos e tanques. Esses registros alimentam as opções disponíveis nos lançamentos.",
          tip:
            "Prefira atualizar um cadastro existente em vez de criar duplicidades.",
        },
        {
          title: "6. Laboratório",
          icon: Gauge,
          text:
            "A aba Laboratório permite ao Administrador consultar Temperatura, Densidade e API informados pelo setor responsável e marcar uma análise como conferida.",
          tip:
            "Os resultados laboratoriais não são transferidos automaticamente para uma carga.",
        },
        {
          title: "7. Configurações",
          icon: Settings,
          text:
            "Em Configurações ficam parâmetros gerais do SCRC, como produto padrão, unidade e limite de divergência. Altere somente quando houver necessidade operacional.",
          tip:
            "Mudanças de configuração podem influenciar cálculos e alertas futuros.",
        },
        {
          title: "8. Segurança e saída",
          icon: Lock,
          text:
            "O Modo Admin exige autenticação e MFA. Ao terminar uma operação administrativa, use Sair. O sistema também encerra o acesso restrito após inatividade.",
          tip:
            "O modo Visitante continua disponível para consultas permitidas.",
        },
      ];
    }

    return [
      {
        title: "Bem-vindo ao SCRC",
        icon: BookOpen,
        text:
          "No modo Visitante você pode consultar as informações liberadas do sistema sem alterar os dados. Use este guia para conhecer as principais áreas.",
        tip:
          "Para lançar ou alterar informações é necessário entrar pelo Acesso restrito com uma conta autorizada.",
      },
      {
        title: "1. Histórico",
        icon: ClipboardList,
        text:
          "Consulte cargas de Entrada e Saída, utilize a busca e filtre por mês para encontrar rapidamente uma movimentação.",
        tip:
          "O Histórico é a área principal para conferência dos registros existentes.",
      },
      {
        title: "2. Painel Resumo",
        icon: LayoutDashboard,
        text:
          "Veja totais e comparativos das cargas registradas. É possível alternar entre Entradas, Saídas e visão Consolidada.",
        tip:
          "Use o painel para uma visão rápida; para detalhes, volte ao Histórico.",
      },
      {
        title: "3. Cadastros",
        icon: Warehouse,
        text:
          "Consulte as referências cadastradas, como fornecedores, motoristas, veículos, produtos e tanques.",
        tip:
          "No modo Visitante essas informações são apenas para consulta.",
      },
      {
        title: "4. Acesso restrito",
        icon: Lock,
        text:
          "Administradores e usuários do Laboratório entram pelo botão Acesso restrito. O sistema exige as permissões corretas e autenticação MFA.",
        tip:
          "Cada perfil vê somente as funções liberadas para sua atividade.",
      },
    ];
  }, [mode]);

  useEffect(() => {
    setStepIndex(0);
  }, [mode]);

  const step = steps[stepIndex];
  const Icon = step.icon || BookOpen;
  const first = stepIndex === 0;
  const last = stepIndex === steps.length - 1;

  const modeLabel =
    mode === "admin"
      ? "Guia do Administrador"
      : mode === "laboratorio"
        ? "Guia do Laboratório"
        : "Guia do Visitante";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 160,
        background: "rgba(0,0,0,.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680,
          maxWidth: "100%",
          background: C.panel,
          border: `1px solid ${C.borderLight}`,
          borderRadius: 8,
          boxShadow: "0 28px 80px rgba(0,0,0,.5)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 6,
                background: `${C.accentDim}44`,
                border: `1px solid ${C.accent}44`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <HelpCircle size={18} color={C.accent} />
            </div>
            <div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  letterSpacing: ".09em",
                  textTransform: "uppercase",
                  color: C.accent,
                }}
              >
                Como usar o SCRC
              </div>
              <div
                style={{
                  color: C.text,
                  fontFamily: DISPLAY,
                  fontWeight: 800,
                  fontSize: 18,
                }}
              >
                {modeLabel}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            title="Fechar guia"
            style={{
              background: "none",
              border: "none",
              color: C.textDim,
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "22px 22px 18px" }}>
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 20,
            }}
          >
            {steps.map((_, index) => (
              <div
                key={index}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 3,
                  background: index <= stepIndex ? C.accent : C.border,
                }}
              />
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "58px 1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 8,
                background: C.panelAlt,
                border: `1px solid ${C.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={25} color={C.accent} />
            </div>

            <div>
              <div
                style={{
                  color: C.textFaint,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  marginBottom: 5,
                }}
              >
                Passo {stepIndex + 1} de {steps.length}
              </div>

              <h2
                style={{
                  margin: 0,
                  color: C.text,
                  fontFamily: DISPLAY,
                  textTransform: "uppercase",
                  fontSize: 24,
                  lineHeight: 1.1,
                }}
              >
                {step.title}
              </h2>

              <p
                style={{
                  color: C.textDim,
                  fontSize: 14,
                  lineHeight: 1.65,
                  margin: "13px 0 0",
                }}
              >
                {step.text}
              </p>

              <div
                style={{
                  marginTop: 16,
                  padding: "11px 13px",
                  borderRadius: 5,
                  background: "#1B2530",
                  border: `1px solid ${C.steel}44`,
                  color: C.textDim,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: C.steel }}>Dica:</strong> {step.tip}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderTop: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ color: C.textFaint, fontSize: 11.5 }}>
            Este guia aparece automaticamente apenas na primeira utilização deste perfil neste navegador.
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {!first && (
              <Btn
                variant="ghost"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                <ArrowLeft size={14} /> Anterior
              </Btn>
            )}

            {!last ? (
              <Btn
                onClick={() =>
                  setStepIndex((i) => Math.min(steps.length - 1, i + 1))
                }
              >
                Próximo <ArrowRight size={14} />
              </Btn>
            ) : (
              <Btn onClick={onClose}>
                <Check size={14} /> Concluir
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginModal({ onClose, onCancel, onSubmit, onVerify }) {
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [stage, setStage] = useState("credentials");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [profile, setProfile] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const closeSafely = async () => {
    if (submitting) return;
    await onCancel?.();
    onClose();
  };

  const submitCredentials = async () => {
    if (!email.trim() || !pwd || submitting) return;

    setSubmitting(true);
    setErrorMsg("");
    try {
      const result = await onSubmit(email, pwd);
      setFactorId(result.factorId || "");
      setProfile(result.profile || "");

      if (result.step === "enroll") {
        setQrCode(result.qrCode || "");
        setSecret(result.secret || "");
        setStage("enroll");
      } else {
        setStage("verify");
      }
    } catch (error) {
      console.error("Falha no acesso restrito:", error);

      if (error?.code === "SCRC_RESTRICTED_NOT_AUTHORIZED") {
        setErrorMsg("Acesso não autorizado. Este usuário não possui perfil ativo de Administrador ou Laboratório.");
      } else {
        setErrorMsg("E-mail ou senha inválidos.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitMfa = async () => {
    const code = mfaCode.replace(/\D/g, "");
    if (code.length !== 6 || !factorId || submitting) return;

    setSubmitting(true);
    setErrorMsg("");
    try {
      await onVerify(factorId, code);
    } catch (error) {
      console.error("Falha na validação MFA:", error);
      setErrorMsg("Código do autenticador inválido ou expirado. Gere um novo código e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const qrSrc = qrCode
    ? (qrCode.startsWith("data:") ? qrCode : `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`)
    : "";

  return (
    <div
      onClick={closeSafely}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 24, width: stage === "enroll" ? 410 : 340, maxWidth: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={16} color={C.accent} />
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, textTransform: "uppercase" }}>
              {stage === "credentials" ? "Acesso restrito" : stage === "enroll" ? "Configurar MFA" : "Verificação MFA"}
            </span>
          </div>
          <button onClick={closeSafely} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        {stage === "credentials" && (
          <>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="E-mail">
                <Input
                  type="email"
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitCredentials(); }}
                  placeholder="seu@email.com"
                />
              </Field>
              <Field label="Senha">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitCredentials(); }}
                />
              </Field>
            </div>

            <div style={{ marginTop: 16 }}>
              <Btn
                onClick={submitCredentials}
                disabled={submitting || !email.trim() || !pwd}
                style={{
                  width: "100%", justifyContent: "center",
                  opacity: submitting || !email.trim() || !pwd ? 0.55 : 1,
                  pointerEvents: submitting || !email.trim() || !pwd ? "none" : "auto",
                }}
              >
                {submitting ? "Validando…" : "Continuar"}
              </Btn>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.45, color: C.textFaint }}>
              O acesso de Administrador e Laboratório exige senha e autenticação em dois fatores (MFA).
            </div>
          </>
        )}

        {stage === "enroll" && (
          <>
            <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.55, marginBottom: 14 }}>
              Primeiro acesso com MFA para <strong style={{ color: C.text }}>{profile}</strong>.
              Escaneie o QR Code no Microsoft Authenticator, Google Authenticator ou outro aplicativo TOTP.
            </div>

            {qrSrc && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                <div style={{ background: "#fff", padding: 10, borderRadius: 8 }}>
                  <img src={qrSrc} alt="QR Code para configurar MFA" style={{ display: "block", width: 190, height: 190 }} />
                </div>
              </div>
            )}

            {secret && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, color: C.textDim, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>
                  Chave manual (caso não consiga escanear)
                </div>
                <div style={{
                  fontFamily: MONO, fontSize: 12, color: C.text, background: C.panelAlt,
                  border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 10px",
                  wordBreak: "break-all", userSelect: "all",
                }}>
                  {secret}
                </div>
              </div>
            )}

            <Field label="Código de 6 dígitos">
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") submitMfa(); }}
                placeholder="000000"
                style={{ fontFamily: MONO, letterSpacing: ".18em", textAlign: "center", fontSize: 18 }}
              />
            </Field>

            <div style={{ marginTop: 16 }}>
              <Btn
                onClick={submitMfa}
                disabled={submitting || mfaCode.length !== 6}
                style={{
                  width: "100%", justifyContent: "center",
                  opacity: submitting || mfaCode.length !== 6 ? 0.55 : 1,
                  pointerEvents: submitting || mfaCode.length !== 6 ? "none" : "auto",
                }}
              >
                {submitting ? "Ativando…" : "Ativar MFA e entrar"}
              </Btn>
            </div>
          </>
        )}

        {stage === "verify" && (
          <>
            <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.55, marginBottom: 14 }}>
              Abra o aplicativo autenticador vinculado ao SCRC e informe o código temporário de 6 dígitos.
            </div>
            <Field label="Código de 6 dígitos">
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") submitMfa(); }}
                placeholder="000000"
                style={{ fontFamily: MONO, letterSpacing: ".18em", textAlign: "center", fontSize: 18 }}
              />
            </Field>

            <div style={{ marginTop: 16 }}>
              <Btn
                onClick={submitMfa}
                disabled={submitting || mfaCode.length !== 6}
                style={{
                  width: "100%", justifyContent: "center",
                  opacity: submitting || mfaCode.length !== 6 ? 0.55 : 1,
                  pointerEvents: submitting || mfaCode.length !== 6 ? "none" : "auto",
                }}
              >
                {submitting ? "Verificando…" : "Verificar e entrar"}
              </Btn>
            </div>
          </>
        )}

        {errorMsg && (
          <div style={{
            marginTop: 12, background: C.redBg, border: `1px solid ${C.red}55`, color: C.red,
            borderRadius: 4, padding: "9px 10px", fontSize: 12.5,
          }}>
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadOnlyNotice({ text, onEnter }) {
  return (
    <Card style={{ textAlign: "center", padding: "40px 20px" }}>
      <Eye size={26} color={C.textFaint} style={{ marginBottom: 12 }} />
      <div style={{ color: C.textDim, fontSize: 14, marginBottom: 16 }}>{text}</div>
      <Btn variant="ghost" onClick={onEnter}><Lock size={13} /> Acesso restrito</Btn>
    </Card>
  );
}

/* ---------------------------------------------------------------------
   TAB: LANÇAR CARGA
--------------------------------------------------------------------- */
function LancarCarga({ cadastros, config, onSave, tipo = "entrada" }) {
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    produto: config.aplicarProdutoPadrao ? config.produtoPadrao : "",
    status: tipo === "saida" ? STATUS_SAIDA : (config.statusPadrao || "PENDENTE"),
  }));
  const [showConfirmacao, setShowConfirmacao] = useState(false);
  const [analisesLaboratorio, setAnalisesLaboratorio] = useState([]);
  const [carregandoLaboratorio, setCarregandoLaboratorio] = useState(true);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    let ativo = true;

    const carregarLaboratorio = async () => {
      setCarregandoLaboratorio(true);
      try {
        const data = await listarAnalisesLaboratorioAdmin();
        if (ativo) setAnalisesLaboratorio(data || []);
      } catch (error) {
        console.error("Erro ao carregar referências do Laboratório:", error);
        if (ativo) setAnalisesLaboratorio([]);
      } finally {
        if (ativo) setCarregandoLaboratorio(false);
      }
    };

    void carregarLaboratorio();

    return () => {
      ativo = false;
    };
  }, []);

  const calc = useMemo(() => computeCarga(form, cadastros.veiculos, config), [form, cadastros.veiculos, config]);
  const isSaida = tipo === "saida";
  const tituloLancamento = isSaida ? "Lançar Carga de Saída" : "Lançar Carga de Entrada";
  const eyebrowLancamento = isSaida ? "Nova saída" : "Nova entrada";
  const textoBotao = isSaida ? "Registrar saída" : "Registrar entrada";

  const produtosAtivos = cadastros.produtos.filter((p) => p.status === "ATIVO");
  const tanquesAtivos = cadastros.tanques.filter((t) => t.status === "ATIVO");
  const motoristasAtivos = cadastros.motoristas.filter((m) => m.status === "ATIVO");
  const fornecedoresAtivos = cadastros.fornecedores.filter((f) => f.status === "ATIVO");

  const referenciasLaboratorio = useMemo(() => {
    const movimentoEsperado = isSaida ? "SAIDA" : "ENTRADA";
    const placa = String(form.placa || "").trim().toUpperCase();
    const nf = String(form.notaFiscal || "").trim().toLowerCase();
    const produto = String(form.produto || "").trim().toLowerCase();
    const data = String(form.data || "").trim();

    return (analisesLaboratorio || [])
      .filter((a) => String(a.tipo_movimento || "").toUpperCase() === movimentoEsperado)
      .map((a) => {
        let pontos = 0;

        if (placa && String(a.placa || "").trim().toUpperCase() === placa) pontos += 4;
        if (nf && String(a.nota_fiscal || "").trim().toLowerCase() === nf) pontos += 4;
        if (produto && String(a.produto || "").trim().toLowerCase() === produto) pontos += 2;
        if (data && String(a.data_referencia || "") === data) pontos += 2;

        return { ...a, _pontos: pontos };
      })
      .filter((a) => {
        // Sem qualquer identificação preenchida, mostra apenas as análises
        // mais recentes do mesmo tipo de movimento.
        if (!placa && !nf && !produto && !data) return true;

        // Com dados preenchidos, exige ao menos uma correspondência.
        return a._pontos > 0;
      })
      .sort((a, b) => {
        if (b._pontos !== a._pontos) return b._pontos - a._pontos;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      })
      .slice(0, 5);
  }, [
    analisesLaboratorio,
    isSaida,
    form.placa,
    form.notaFiscal,
    form.produto,
    form.data,
  ]);

  const requiredOk = form.data && form.placa && form.produto && form.tanque &&
    form.ofertado && form.pesoBruto && form.tara && form.densidade;

  const submit = () => {
    if (!requiredOk) return;
    setShowConfirmacao(true);
  };

  const confirmarSubmit = () => {
    const fornecedorSelecionado = cadastros.fornecedores.find(
      (f) => f.nome === form.fornecedor
    );

    onSave({
      ...form,
      status: isSaida ? STATUS_SAIDA : form.status,
      cnpj: fornecedorSelecionado?.cnpj || "",
    });

    setShowConfirmacao(false);

    setForm({
      ...emptyForm,
      produto: config.aplicarProdutoPadrao ? config.produtoPadrao : "",
      status: isSaida ? STATUS_SAIDA : (config.statusPadrao || "PENDENTE"),
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }} className="scrc-grid">
      <Card>
        <SectionTitle eyebrow={eyebrowLancamento} title={tituloLancamento} />

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
          <div style={{ display: "grid", gridTemplateColumns: isSaida ? "repeat(4,1fr)" : "repeat(3,1fr)", gap: 12 }}>
            <Field label="ICMS (%)" hint="ex: 18 para 18%"><Input type="number" step="0.01" value={form.icms} onChange={set("icms")} /></Field>
            <Field label="PIS (%)" hint="ex: 1,65 para 1,65%"><Input type="number" step="0.01" value={form.pis} onChange={set("pis")} /></Field>
            <Field label="COFINS (%)" hint="ex: 7,6 para 7,6%"><Input type="number" step="0.01" value={form.cofins} onChange={set("cofins")} /></Field>
            {isSaida && (
              <Field label="CIDE (R$/L)" hint="valor literal por litro aplicado sobre o Volume Líquido"><Input type="number" step="0.01" value={form.cide} onChange={set("cide")} /></Field>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label={isSaida ? "Tanque origem" : "Tanque destino"} required>
              <Select value={form.tanque} onChange={set("tanque")}>
                <option value="">Selecione…</option>
                {tanquesAtivos.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              {isSaida ? (
                <Input value={STATUS_SAIDA} readOnly style={{ cursor: "not-allowed", opacity: 0.85 }} />
              ) : (
                <Select value={form.status} onChange={set("status")}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            <Field label="Lote"><Input value={form.lote} onChange={set("lote")} /></Field>
            <Field label="Observações"><Input value={form.observacoes} onChange={set("observacoes")} /></Field>
          </div>

          <div style={{ marginTop: 6 }}>
            <Btn onClick={submit} style={!requiredOk ? { opacity: 0.4, pointerEvents: "none" } : {}}>
              <Save size={14} /> {textoBotao}
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
        <SectionTitle eyebrow="Consulta" title="Referência do Laboratório" />

        <div
          style={{
            background: "#1B2530",
            border: `1px solid ${C.steel}44`,
            borderRadius: 5,
            padding: "10px 12px",
            marginTop: -6,
            marginBottom: 12,
            color: C.textDim,
            fontSize: 11.5,
            lineHeight: 1.5,
          }}
        >
          Esta área é somente para conferência. Os valores abaixo <strong style={{ color: C.text }}>não preenchem</strong>{" "}
          API ou Densidade automaticamente no lançamento.
        </div>

        {carregandoLaboratorio ? (
          <div style={{ color: C.textDim, fontSize: 12.5 }}>
            Consultando análises disponíveis…
          </div>
        ) : referenciasLaboratorio.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${C.border}`,
              borderRadius: 5,
              padding: "14px 12px",
              color: C.textFaint,
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            Nenhuma análise do Laboratório encontrada para os dados informados nesta carga.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {referenciasLaboratorio.map((a, index) => (
              <div
                key={a.id}
                style={{
                  border: `1px solid ${index === 0 ? C.accent + "55" : C.border}`,
                  background: index === 0 ? `${C.accentDim}18` : C.panelAlt,
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 9,
                  }}
                >
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10.5,
                      color: index === 0 ? C.accent : C.textDim,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                    }}
                  >
                    {index === 0 ? "Melhor correspondência" : "Possível correspondência"}
                  </div>

                  <Pill
                    text={a.conferido ? "Conferido" : "Disponível"}
                    fg={a.conferido ? C.green : C.yellow}
                    bg={a.conferido ? C.greenBg : C.yellowBg}
                  />
                </div>

                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 9, lineHeight: 1.45 }}>
                  <strong style={{ color: C.text }}>{a.placa || "Sem placa"}</strong>
                  {" • "}
                  {a.data_referencia || "Sem data"}
                  {" • NF "}
                  {a.nota_fiscal || "—"}
                  {" • "}
                  {a.produto || "—"}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                    gap: 8,
                  }}
                >
                  <div style={{ background: C.bg, borderRadius: 4, padding: "8px 9px" }}>
                    <div style={{ color: C.textFaint, fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em" }}>
                      Temperatura
                    </div>
                    <div style={{ color: C.text, fontFamily: MONO, marginTop: 3, fontWeight: 700 }}>
                      {Number(a.temperatura).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} °C
                    </div>
                  </div>

                  <div style={{ background: C.bg, borderRadius: 4, padding: "8px 9px" }}>
                    <div style={{ color: C.textFaint, fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em" }}>
                      Densidade
                    </div>
                    <div style={{ color: C.text, fontFamily: MONO, marginTop: 3, fontWeight: 700 }}>
                      {Number(a.densidade).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}
                    </div>
                  </div>

                  <div style={{ background: C.bg, borderRadius: 4, padding: "8px 9px" }}>
                    <div style={{ color: C.textFaint, fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".05em" }}>
                      API
                    </div>
                    <div style={{ color: C.text, fontFamily: MONO, marginTop: 3, fontWeight: 700 }}>
                      {Number(a.api).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
          {isSaida && <PreviewRow label="CIDE" value={fmtR(calc.cide)} />}
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

        <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
          flexWrap: "wrap", fontFamily: MONO, padding: "8px 0",
        }}>
          <EquationBlock label="Volume c/ BSW" value={fmtL(calc.volumeComBSW)} />
          <span style={{ fontSize: 22, color: C.textFaint }}>−</span>
          <EquationBlock label="BS&W (L)" value={fmtL(calc.bswL)} />
          <span style={{ fontSize: 22, color: C.textFaint }}>=</span>
          <EquationBlock label="Volume líquido (L)" value={fmtL(calc.volumeLiquido)} accent big />
        </div>
      </Card>
      </div>

      {showConfirmacao && (
        <ConfirmacaoLancamentoModal
          form={form}
          tipo={tipo}
          cadastros={cadastros}
          config={config}
          onClose={() => setShowConfirmacao(false)}
          onConfirm={confirmarSubmit}
        />
      )}
    </div>
  );
}

function ConfirmacaoLancamentoModal({
  form,
  tipo,
  cadastros,
  config,
  onClose,
  onConfirm,
}) {
  const isSaida = tipo === "saida";
  const calc = computeCarga(form, cadastros.veiculos, config);

  const fornecedorSelecionado = cadastros.fornecedores.find(
    (f) => f.nome === form.fornecedor
  );

  const cnpj = form.cnpj || fornecedorSelecionado?.cnpj || "—";

  const fmtData = (value) => {
    if (!value) return "—";
    const partes = String(value).split("-");
    return partes.length === 3
      ? `${partes[2]}/${partes[1]}/${partes[0]}`
      : value;
  };

  const linha = (label, value, accent = false) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 14,
        padding: "8px 0",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ color: C.textDim, fontSize: 12.5 }}>{label}</span>
      <strong
        style={{
          color: accent ? C.accent : C.text,
          fontFamily: accent ? MONO : "inherit",
          fontSize: 12.5,
          textAlign: "right",
        }}
      >
        {value}
      </strong>
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 170,
        background: "rgba(0,0,0,.80)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
          maxWidth: "100%",
          maxHeight: "88vh",
          overflowY: "auto",
          background: C.panel,
          border: `1px solid ${C.borderLight}`,
          borderRadius: 8,
          boxShadow: "0 28px 80px rgba(0,0,0,.50)",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                color: C.accent,
                fontFamily: MONO,
                fontSize: 10.5,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                marginBottom: 5,
              }}
            >
              Conferência antes de salvar
            </div>

            <div
              style={{
                color: C.text,
                fontFamily: DISPLAY,
                fontSize: 22,
                fontWeight: 800,
                textTransform: "uppercase",
              }}
            >
              Confirmar lançamento de {isSaida ? "saída" : "entrada"}
            </div>

            <div
              style={{
                color: C.textDim,
                fontSize: 12.5,
                marginTop: 5,
              }}
            >
              Revise as principais informações da carga antes de registrá-la.
            </div>
          </div>

          <button
            onClick={onClose}
            title="Fechar e voltar ao formulário"
            style={{
              background: "none",
              border: "none",
              color: C.textDim,
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, display: "grid", gap: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              gap: 12,
            }}
            className="scrc-grid"
          >
            <Card style={{ padding: 14 }}>
              <div
                style={{
                  color: C.textFaint,
                  fontSize: 10.5,
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                  marginBottom: 7,
                }}
              >
                Identificação
              </div>

              {linha("Data", fmtData(form.data))}
              {linha("Placa", form.placa || "—")}
              {linha("Motorista", form.motorista || "—")}
              {linha("Fornecedor", form.fornecedor || "—")}
              {linha("CNPJ", cnpj)}
              {linha("Nota Fiscal", form.notaFiscal || "—")}
              {linha("Produto", form.produto || "—")}
              {linha(isSaida ? "Tanque origem" : "Tanque destino", form.tanque || "—")}
            </Card>

            <Card style={{ padding: 14 }}>
              <div
                style={{
                  color: C.textFaint,
                  fontSize: 10.5,
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                  marginBottom: 7,
                }}
              >
                Operação
              </div>

              {linha("Chegada", form.chegada || "—")}
              {linha("Saída", form.saida || "—")}
              {linha("Ofertado NF", `${fmtBR(num(form.ofertado))} L`)}
              {linha("Peso bruto", `${fmtBR(num(form.pesoBruto))} kg`)}
              {linha("Drenagem de água", `${fmtBR(num(form.drenagem))} L`)}
              {linha("Tara", `${fmtBR(num(form.tara))} kg`)}
              {linha("Peso líquido", `${fmtBR(calc.pesoLiquido)} kg`, true)}
              {linha("Volume líquido", `${fmtBR(calc.volumeLiquido)} L`, true)}
            </Card>
          </div>

          <Card style={{ padding: 14 }}>
            <div
              style={{
                color: C.textFaint,
                fontSize: 10.5,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Qualidade e medição
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,minmax(0,1fr))",
                gap: 10,
              }}
              className="scrc-grid"
            >
              {[
                ["API", form.api || "—"],
                ["Densidade 20º", form.densidade || "—"],
                ["BS&W", `${form.bsw || 0}%`],
                ["Divergência", `${fmtBR(calc.divergencia)} ${calc.unidadeDivergencia}`],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    background: C.panelAlt,
                    border: `1px solid ${C.border}`,
                    borderRadius: 5,
                    padding: "11px 12px",
                  }}
                >
                  <div
                    style={{
                      color: C.textFaint,
                      fontSize: 9.5,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      color:
                        label === "Divergência" && calc.divergenciaAlta
                          ? C.red
                          : C.text,
                      fontFamily: MONO,
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {calc.divergenciaAlta && (
              <div
                style={{
                  marginTop: 12,
                  background: C.redBg,
                  border: `1px solid ${C.red}55`,
                  color: C.red,
                  borderRadius: 5,
                  padding: "9px 11px",
                  fontSize: 12,
                }}
              >
                Atenção: a divergência está acima do limite configurado no SCRC.
              </div>
            )}
          </Card>

          <div
            style={{
              background: "#1B2530",
              border: `1px solid ${C.steel}44`,
              borderRadius: 5,
              padding: "11px 13px",
              color: C.textDim,
              fontSize: 12.5,
              lineHeight: 1.55,
            }}
          >
            <strong style={{ color: C.steel }}>Confira antes de confirmar:</strong>{" "}
            placa, nota fiscal, produto, volume ofertado, peso bruto, tara, API e
            densidade. Se encontrar qualquer erro, volte ao formulário e corrija.
          </div>
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderTop: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <Btn variant="ghost" onClick={onClose}>
            <ArrowLeft size={14} /> Voltar e corrigir
          </Btn>

          <Btn onClick={onConfirm}>
            <Check size={14} /> Confirmar lançamento
          </Btn>
        </div>
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
function Historico({
  cargasEntrada, cargasSaida, cadastros, config, isAdmin,
  onDeleteEntrada, onUpdateEntrada, onDeleteSaida, onUpdateSaida,
}) {
  const [tipoHistorico, setTipoHistorico] = useState("entrada");
  const [monthFilter, setMonthFilter] = useState("todos");
  const [query, setQuery] = useState("");
  const [editingRow, setEditingRow] = useState(null);
  const [showReport, setShowReport] = useState(false);

  const cargas = tipoHistorico === "entrada" ? cargasEntrada : cargasSaida;
  const onDelete = tipoHistorico === "entrada" ? onDeleteEntrada : onDeleteSaida;
  const onUpdate = tipoHistorico === "entrada" ? onUpdateEntrada : onUpdateSaida;
  const tipoLabel = tipoHistorico === "entrada" ? "Entrada" : "Saída";

  const trocarHistorico = (tipo) => {
    setTipoHistorico(tipo);
    setMonthFilter("todos");
    setQuery("");
    setEditingRow(null);
  };

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
      <SectionTitle
        eyebrow={`${cargas.length} ${cargas.length === 1 ? "registro" : "registros"} de ${tipoLabel.toLowerCase()}`}
        title={`Histórico de Cargas — ${tipoLabel}`}
      />

      <div style={{
        display: "inline-flex", gap: 4, padding: 4, marginBottom: 16,
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6,
      }}>
        {[
          { id: "entrada", label: `Cargas de Entrada (${cargasEntrada.length})`, icon: Plus },
          { id: "saida", label: `Cargas de Saída (${cargasSaida.length})`, icon: Truck },
        ].map((item) => {
          const Icon = item.icon;
          const active = tipoHistorico === item.id;
          return (
            <button
              key={item.id}
              onClick={() => trocarHistorico(item.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px",
                background: active ? C.panelAlt : "transparent",
                color: active ? C.accent : C.textDim,
                border: `1px solid ${active ? C.borderLight : "transparent"}`,
                borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
                borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700,
                letterSpacing: "0.03em", textTransform: "uppercase",
              }}
            >
              <Icon size={13} /> {item.label}
            </button>
          );
        })}
      </div>

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

        <Btn onClick={() => setShowReport(true)}>
          <FileText size={14} /> Gerar relatório
        </Btn>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <div style={{ textAlign: "center", padding: "30px 0", color: C.textDim, fontSize: 13 }}>
            Nenhuma carga de {tipoLabel.toLowerCase()} encontrada para os filtros selecionados.
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

      {showReport && (
        <RelatorioTxtModal
          cargasEntrada={cargasEntrada}
          cargasSaida={cargasSaida}
          cadastros={cadastros}
          config={config}
          tipoInicial={tipoHistorico}
          mesInicial={monthFilter !== "todos" ? monthFilter : ""}
          onClose={() => setShowReport(false)}
        />
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


function RelatorioTxtModal({
  cargasEntrada,
  cargasSaida,
  cadastros,
  config,
  tipoInicial,
  mesInicial,
  onClose,
}) {
  const [tipo, setTipo] = useState(tipoInicial || "ambos");
  const [modoPeriodo, setModoPeriodo] = useState(mesInicial ? "mes" : "todos");
  const [mes, setMes] = useState(mesInicial || "");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");

  const periodo = useMemo(
    () => ({
      modo: modoPeriodo,
      mes,
      inicio,
      fim,
    }),
    [modoPeriodo, mes, inicio, fim]
  );

  const contagem = useMemo(() => {
    const entrada =
      tipo === "saida"
        ? 0
        : filtrarCargasRelatorio(cargasEntrada, periodo).length;
    const saida =
      tipo === "entrada"
        ? 0
        : filtrarCargasRelatorio(cargasSaida, periodo).length;

    return {
      entrada,
      saida,
      total: entrada + saida,
    };
  }, [cargasEntrada, cargasSaida, tipo, periodo]);

  const quantidade = contagem.total;

  const intervaloInvalido =
    modoPeriodo === "intervalo" &&
    inicio &&
    fim &&
    inicio > fim;

  const gerar = () => {
    if (intervaloInvalido) return;

    const conteudo = gerarConteudoRelatorioTxt({
      cargasEntrada,
      cargasSaida,
      cadastros,
      config,
      tipo,
      periodo,
    });

    baixarRelatorioTxt(conteudo, tipo);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 130,
        background: "rgba(0,0,0,.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "100%",
          background: C.panel,
          border: `1px solid ${C.borderLight}`,
          borderRadius: 8,
          padding: 22,
          boxShadow: "0 24px 70px rgba(0,0,0,.45)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                color: C.accent,
                fontFamily: MONO,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: ".09em",
                marginBottom: 5,
              }}
            >
              Exportação TXT
            </div>
            <div
              style={{
                color: C.text,
                fontFamily: DISPLAY,
                fontSize: 21,
                fontWeight: 800,
                textTransform: "uppercase",
              }}
            >
              Gerar relatório SCRC
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.textDim,
              cursor: "pointer",
              padding: 3,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: "11px 13px",
            borderRadius: 5,
            background: "#1B2530",
            border: `1px solid ${C.steel}44`,
            color: C.textDim,
            fontSize: 12,
            lineHeight: 1.5,
            marginBottom: 18,
          }}
        >
          O relatório será gerado no próprio navegador em formato <strong style={{ color: C.text }}>.txt</strong>,
          compatível com o Bloco de Notas e sem depender deste computador.
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Movimentações">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="entrada">Somente entradas</option>
              <option value="saida">Somente saídas</option>
              <option value="ambos">Entradas + saídas</option>
            </Select>
          </Field>

          <Field label="Período">
            <Select
              value={modoPeriodo}
              onChange={(e) => setModoPeriodo(e.target.value)}
            >
              <option value="todos">Todos os registros</option>
              <option value="mes">Mês específico</option>
              <option value="intervalo">Intervalo de datas</option>
            </Select>
          </Field>

          {modoPeriodo === "mes" && (
            <Field label="Mês">
              <Input
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              />
            </Field>
          )}

          {modoPeriodo === "intervalo" && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                  gap: 12,
                }}
                className="scrc-grid"
              >
                <Field label="Data inicial">
                  <Input
                    type="date"
                    value={inicio}
                    onChange={(e) => setInicio(e.target.value)}
                  />
                </Field>
                <Field label="Data final">
                  <Input
                    type="date"
                    value={fim}
                    onChange={(e) => setFim(e.target.value)}
                  />
                </Field>
              </div>

              {intervaloInvalido && (
                <div
                  style={{
                    color: C.red,
                    background: C.redBg,
                    border: `1px solid ${C.red}55`,
                    borderRadius: 4,
                    padding: "8px 10px",
                    fontSize: 12,
                  }}
                >
                  A data inicial não pode ser posterior à data final.
                </div>
              )}
            </>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              paddingTop: 14,
              marginTop: 2,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <div style={{ color: C.textDim, fontSize: 12.5, lineHeight: 1.5 }}>
              <strong style={{ color: C.text }}>{quantidade}</strong>{" "}
              movimentação{quantidade === 1 ? "" : "ões"} no relatório
              {tipo === "ambos" && (
                <div style={{ color: C.textFaint, fontSize: 11.5 }}>
                  {contagem.entrada} entrada{contagem.entrada === 1 ? "" : "s"} +{" "}
                  {contagem.saida} saída{contagem.saida === 1 ? "" : "s"}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" onClick={onClose}>
                Cancelar
              </Btn>
              <Btn
                onClick={gerar}
                disabled={quantidade === 0 || intervaloInvalido}
                style={
                  quantidade === 0 || intervaloInvalido
                    ? { opacity: 0.45, pointerEvents: "none" }
                    : {}
                }
              >
                <Download size={14} /> Gerar .TXT
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
function PainelResumo({ cargasEntrada, cargasSaida, cadastros, config }) {
  const [tipoPainel, setTipoPainel] = useState("entrada");

  const cargas = useMemo(() => {
    if (tipoPainel === "saida") return cargasSaida;
    if (tipoPainel === "consolidado") return [...cargasEntrada, ...cargasSaida];
    return cargasEntrada;
  }, [tipoPainel, cargasEntrada, cargasSaida]);

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
    ofertado: m.ofertado,
    liquido: m.liquido,
    divergencia: m.divergencia,
    divergenciaPct: m.ofertado > 0 ? (m.divergencia / m.ofertado) * 100 : 0,
  }));

  const tituloTipo = tipoPainel === "entrada"
    ? "Cargas de Entrada"
    : tipoPainel === "saida"
      ? "Cargas de Saída"
      : "Consolidado — Entrada + Saída";

  const botoes = [
    { id: "entrada", label: `Entradas (${cargasEntrada.length})` },
    { id: "saida", label: `Saídas (${cargasSaida.length})` },
    { id: "consolidado", label: `Consolidado (${cargasEntrada.length + cargasSaida.length})` },
  ];

  return (
    <div>
      <SectionTitle eyebrow="Comparativo mensal" title="Painel Resumo" />

      <Card style={{ marginBottom: 20, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10.5, color: C.textDim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
              Visualização do resumo
            </div>
            <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, color: C.text }}>
              {tituloTipo}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {botoes.map((b) => {
              const active = tipoPainel === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setTipoPainel(b.id)}
                  style={{
                    background: active ? `${C.accentDim}44` : C.panelAlt,
                    color: active ? C.accent : C.textDim,
                    border: `1px solid ${active ? C.accentDim : C.border}`,
                    borderBottom: active ? `2px solid ${C.accent}` : `2px solid ${C.border}`,
                    borderRadius: 4,
                    padding: "8px 13px",
                    fontSize: 11.5,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {cargas.length === 0 ? (
        <Card><div style={{ textAlign: "center", padding: "30px 0", color: C.textDim, fontSize: 13 }}>
          Nenhuma carga de {tipoPainel === "saida" ? "saída" : "entrada"} lançada ainda.
        </div></Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14, marginBottom: 20 }} className="scrc-stats">
            <Stat label="Ofertado (L)" value={fmtL(totals.ofertado)} />
            <Stat label="Volume líquido (L)" value={fmtL(totals.liquido)} accent />
            <Stat label="Divergência (L)" value={`${totals.divergencia.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <Stat label="Tributos" value={fmtR(totals.tributos)} />
            <Stat label="Valor total" value={fmtR(totals.custo)} />
          </div>

          <Card style={{ marginBottom: 20 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {tituloTipo} — Comparativo Mensal — Volume Ofertado na NF × Volume Líquido Calculado
              </div>
              <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 5 }}>
                A diferença entre os volumes representa a divergência apurada no período. Passe o mouse sobre as barras para ver os detalhes.
              </div>
            </div>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 24, right: 12, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="mes" stroke={C.textDim} fontSize={12} />
                  <YAxis
                    stroke={C.textDim}
                    fontSize={12}
                    tickFormatter={(v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.025)" }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      if (!d) return null;
                      return (
                        <div style={{
                          background: C.panelAlt, border: `1px solid ${C.borderLight}`, borderRadius: 6,
                          padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,.35)", minWidth: 230,
                        }}>
                          <div style={{ fontWeight: 800, color: C.text, marginBottom: 8 }}>{label}</div>
                          <div style={{ display: "grid", gap: 5, fontSize: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                              <span style={{ color: C.textDim }}>Ofertado na NF</span>
                              <strong style={{ color: C.steel }}>{fmtL(d.ofertado)}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                              <span style={{ color: C.textDim }}>Volume líquido calculado</span>
                              <strong style={{ color: C.accent }}>{fmtL(d.liquido)}</strong>
                            </div>
                            <div style={{ height: 1, background: C.border, margin: "3px 0" }} />
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                              <span style={{ color: C.textDim }}>Divergência</span>
                              <strong style={{ color: C.text }}>{fmtL(d.divergencia)}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                              <span style={{ color: C.textDim }}>Divergência percentual</span>
                              <strong style={{ color: C.text }}>{d.divergenciaPct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</strong>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="ofertado" name="Ofertado na NF (L)" fill={C.steel} radius={[3, 3, 0, 0]}>
                    <LabelList
                      dataKey="ofertado"
                      position="top"
                      fill={C.textDim}
                      fontSize={10}
                      formatter={(v) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L`}
                    />
                  </Bar>
                  <Bar dataKey="liquido" name="Volume Líquido Calculado (L)" fill={C.accent} radius={[3, 3, 0, 0]}>
                    <LabelList
                      dataKey="liquido"
                      position="top"
                      fill={C.textDim}
                      fontSize={10}
                      formatter={(v) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L`}
                    />
                  </Bar>
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
        </>
      )}
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
