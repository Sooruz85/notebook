-- Colonne voyage_id sur journal_entries (requis pour l’app).
-- À exécuter dans Supabase SQL Editor si la migration auto n’est pas utilisée.

alter table journal_entries
  add column if not exists voyage_id uuid references voyages(id) on delete set null;

create index if not exists journal_entries_voyage_id_idx on journal_entries (voyage_id);
