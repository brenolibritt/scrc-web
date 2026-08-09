import { supabase } from './supabaseClient.js'

// Mesma "forma" da API window.storage usada nos artefatos do Claude,
// só que salvando numa tabela real do Supabase (compartilhada entre
// todo mundo que acessa o site).
//
// Tabela esperada (ver README.md para o SQL de criação):
//   scrc_kv (key text primary key, value text, updated_at timestamptz)

export async function storageGet(key) {
  const { data, error } = await supabase
    .from('scrc_kv')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { key, value: data.value }
}

export async function storageSet(key, value) {
  const { error } = await supabase
    .from('scrc_kv')
    .upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) throw error
  return { key, value }
}
