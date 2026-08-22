import { supabase } from "./supabaseClient.js";

export async function listarAnalisesLaboratorio() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;

  const userId = userData?.user?.id;
  if (!userId) throw new Error("Sessão do Laboratório não encontrada.");

  const { data, error } = await supabase
    .from("scrc_laboratorio")
    .select(
      "id,carga_id,tipo_movimento,data_referencia,placa,nota_fiscal,produto,temperatura,densidade,api,user_id,conferido,created_at,updated_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function criarAnaliseLaboratorio(payload) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;

  const userId = userData?.user?.id;
  if (!userId) throw new Error("Sessão do Laboratório não encontrada.");

  const registro = {
    carga_id: payload.carga_id || null,
    tipo_movimento: payload.tipo_movimento,
    data_referencia: payload.data_referencia,
    placa: payload.placa,
    nota_fiscal: payload.nota_fiscal || null,
    produto: payload.produto,
    temperatura: payload.temperatura,
    densidade: payload.densidade,
    api: payload.api,
    user_id: userId,
    conferido: false,
  };

  const { data, error } = await supabase
    .from("scrc_laboratorio")
    .insert(registro)
    .select(
      "id,carga_id,tipo_movimento,data_referencia,placa,nota_fiscal,produto,temperatura,densidade,api,user_id,conferido,created_at,updated_at"
    )
    .single();

  if (error) throw error;
  return data;
}


export async function listarAnalisesLaboratorioAdmin() {
  const { data, error } = await supabase
    .from("scrc_laboratorio")
    .select(
      "id,carga_id,tipo_movimento,data_referencia,placa,nota_fiscal,produto,temperatura,densidade,api,user_id,conferido,created_at,updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function conferirAnaliseLaboratorio(analiseId, conferido = true) {
  const { error } = await supabase.rpc(
    "scrc_conferir_analise_laboratorio",
    {
      p_analise_id: analiseId,
      p_conferido: conferido,
    }
  );

  if (error) throw error;
  return true;
}
